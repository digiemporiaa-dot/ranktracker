'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownUp, ExternalLink, Loader2, MapPin, Search, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChangeCell, PositionCell } from '@/components/position-cell';
import { Alert } from '@/components/ui/alert';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DEVICE_FILTERS,
  RANKING_FILTERS,
  groupByDevice,
  matchesDevice,
  matchesFilter,
  type ChangeKind,
  type DeviceFilter,
  type RankingFilter,
} from '@/lib/ranking';
import { locationLabel } from '@/components/search-summary';
import { cn, displayUrl, formatRelativeDay } from '@/lib/utils';

export type RankingRow = {
  id: string;
  keyword: string;
  targetUrl: string | null;
  /** DESKTOP or MOBILE. One row per device: they are never merged. */
  device: string;
  country: string;
  city: string | null;
  locationCode: number;
  language: string;
  position: number | null;
  rankingUrl: string | null;
  checkedAt: string | null;
  previousPosition: number | null;
  changeKind: ChangeKind;
  changeDelta: number | null;
  changeLabel: string;
};

type SortField = 'keyword' | 'position' | 'change' | 'checkedAt';

const PAGE_SIZE = 50;

/**
 * The ranking table.
 *
 * Filtering, search and sorting run in the browser over the rows the server
 * already sent (latest + previous ranking only — never the whole history).
 *
 * Each row is one keyword on one device. With the device filter on "All" the
 * rows are pivoted so desktop and mobile sit in their own columns; picking a
 * device shows that device's positions on their own. Either way the two are
 * only ever displayed together, never combined: a keyword tracked on desktop
 * alone shows nothing under Mobile rather than repeating its desktop position.
 */
export function RankingsTable({
  rows,
  projectId,
}: {
  rows: RankingRow[];
  projectId?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  // Deleted ids are hidden immediately and restored if the request fails.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<'row' | 'bulk' | null>(null);
  const [rowTarget, setRowTarget] = useState<{ keyword: string; ids: string[] } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // A refresh brings new rows; anything still hidden has really gone.
  useEffect(() => {
    setRemoved(new Set());
    setSelected(new Set());
  }, [rows]);

  const canDelete = Boolean(projectId);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RankingFilter>('all');
  const [device, setDevice] = useState<DeviceFilter>('all');
  const [sort, setSort] = useState<SortField>('position');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  // More than one location in the same project happens when the project's
  // location was changed and more keywords were added afterwards. The old
  // keywords keep their own, so the table has to say which is which.
  const showLocation = useMemo(
    () => new Set(rows.map((row) => row.locationCode)).size > 1,
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const result = matchesDevice(rows, device).filter((row) => {
      if (removed.has(row.id)) return false;
      if (needle && !row.keyword.toLowerCase().includes(needle)) return false;
      return matchesFilter(filter, row.position, row.changeKind);
    });

    const sign = direction === 'desc' ? -1 : 1;

    return [...result].sort((a, b) => {
      switch (sort) {
        case 'keyword':
          return sign * a.keyword.localeCompare(b.keyword);
        case 'change': {
          const av = a.changeDelta ?? 0;
          const bv = b.changeDelta ?? 0;
          return -sign * (av - bv);
        }
        case 'checkedAt': {
          const av = a.checkedAt ? Date.parse(a.checkedAt) : 0;
          const bv = b.checkedAt ? Date.parse(b.checkedAt) : 0;
          return -sign * (av - bv);
        }
        case 'position':
        default: {
          // "Not Found" always sorts last.
          const av = a.position ?? Number.MAX_SAFE_INTEGER;
          const bv = b.position ?? Number.MAX_SAFE_INTEGER;
          return sign * (av - bv);
        }
      }
    });
  }, [rows, removed, search, filter, device, sort, direction]);

  const grouped = device === 'all';

  /** One entry per visible line: a pivoted group, or a single-device row. */
  const lines = useMemo(() => {
    if (!grouped) {
      return filtered.map((row) => ({
        key: row.id,
        keyword: row.keyword,
        locationCode: row.locationCode,
        city: row.city,
        country: row.country,
        targetUrl: row.targetUrl,
        desktop: row.device === 'MOBILE' ? null : row,
        mobile: row.device === 'MOBILE' ? row : null,
        single: row as RankingRow | null,
        keywordIds: [row.id],
      }));
    }

    return groupByDevice(filtered).map((group) => {
      const sample = group.desktop ?? group.mobile;
      return {
        key: group.key,
        keyword: group.keyword,
        locationCode: group.locationCode,
        city: sample?.city ?? null,
        country: sample?.country ?? '',
        targetUrl: sample?.targetUrl ?? null,
        desktop: group.desktop,
        mobile: group.mobile,
        single: null as RankingRow | null,
        keywordIds: group.keywordIds,
      };
    });
  }, [filtered, grouped]);

  // What "all of them" means for the view currently shown: pivoted lines are
  // counted against all pivoted lines, single-device rows against that
  // device's rows. Counting lines against per-device rows would report an
  // unfiltered two-device project as "2 of 4".
  const totalLines = useMemo(() => {
    const all = matchesDevice(rows, device);
    return grouped ? groupByDevice(all).length : all.length;
  }, [rows, device, grouped]);

  const totalPages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = lines.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sort === field) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setDirection(field === 'keyword' || field === 'position' ? 'asc' : 'desc');
    }
    setPage(1);
  }

  // Selection is always by keyword id, so a pivoted line selects both of its
  // devices and a bulk delete removes exactly the rows the user can see.
  const visibleIds = visible.flatMap((line) => line.keywordIds);
  const allOnPageSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleLine(ids: string[]) {
    setSelected((current) => {
      const next = new Set(current);
      const isSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => (isSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function togglePage() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  /** Hide the ids straight away, and put them back if the request fails. */
  async function runDelete(
    ids: string[],
    perform: () => Promise<{ ok: boolean; deleted: number; error?: string }>,
  ) {
    if (!projectId || ids.length === 0) return;

    setDeleteError(null);
    setDeleting(true);
    setRemoved((current) => new Set([...current, ...ids]));

    const restore = () =>
      setRemoved((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });

    try {
      const result = await perform();

      if (!result.ok) {
        restore();
        setDeleteError(result.error ?? 'That could not be deleted. Please try again.');
        return;
      }

      // Report a partial result honestly rather than claiming full success.
      toast(
        result.deleted === ids.length
          ? `Deleted ${result.deleted} keyword${result.deleted === 1 ? '' : 's'}`
          : `Deleted ${result.deleted} of ${ids.length} keywords`,
      );

      setConfirming(null);
      setRowTarget(null);
      setSelected(new Set());
      router.refresh();
    } catch {
      restore();
      setDeleteError('We could not reach the server. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  /**
   * One line can stand for both devices, so deleting it deletes both rows.
   * They go one at a time through the single-keyword route: that is what
   * removing a couple of keywords is, and it keeps the wholesale-delete
   * allowance for wholesale deletes.
   */
  const deleteLine = (ids: string[], keyword: string) =>
    runDelete(ids, async () => {
      let deleted = 0;
      let error: string | undefined;

      for (const id of ids) {
        const response = await fetch(
          `/api/projects/${projectId}/keywords?keywordId=${encodeURIComponent(id)}`,
          { method: 'DELETE' },
        );
        if (response.ok) {
          deleted += 1;
        } else {
          const data = await response.json().catch(() => ({}));
          error = data.error ?? `"${keyword}" could not be deleted.`;
          break;
        }
      }

      return { ok: deleted > 0, deleted, error: deleted === 0 ? error : undefined };
    });

  const deleteSelected = () => {
    const ids = [...selected];
    return runDelete(ids, async () => {
      const response = await fetch(`/api/projects/${projectId}/keywords/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywordIds: ids }),
      });
      const data = await response.json().catch(() => ({}));
      return {
        ok: response.ok,
        deleted: typeof data.deleted === 'number' ? data.deleted : ids.length,
        error: data.error,
      };
    });
  };

  const SortableHead = ({ field, label }: { field: SortField; label: string }) => (
    <TableHead>
      <button
        type="button"
        onClick={() => toggleSort(field)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
      >
        {label}
        <ArrowDownUp
          className={cn('h-3 w-3', sort === field ? 'text-foreground' : 'text-muted-foreground/50')}
        />
      </button>
    </TableHead>
  );

  /** Position + change for one device, or a dash when it is not tracked. */
  const DeviceCells = ({ row }: { row: RankingRow | null }) =>
    row ? (
      <>
        <TableCell>
          <PositionCell position={row.position} />
        </TableCell>
        <TableCell>
          <ChangeCell kind={row.changeKind} label={row.changeLabel} />
        </TableCell>
      </>
    ) : (
      <>
        <TableCell className="text-muted-foreground">—</TableCell>
        <TableCell className="text-muted-foreground">—</TableCell>
      </>
    );

  const columnCount = (grouped ? 6 : 5) + (canDelete ? 2 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search keywords"
            className="pl-9"
            aria-label="Search keywords"
          />
        </div>
        <div className="flex items-center gap-3">
          {canDelete && selected.size > 0 ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setDeleteError(null);
                setConfirming('bulk');
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete selected ({selected.size})
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {lines.length === totalLines
              ? `${totalLines} keyword${totalLines === 1 ? '' : 's'}`
              : `${lines.length} of ${totalLines} keyword${totalLines === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {deleteError && !confirming ? <Alert tone="error">{deleteError}</Alert> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {RANKING_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors',
                filter === value
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          className="flex shrink-0 gap-1.5"
          role="group"
          aria-label="Filter by device"
        >
          {DEVICE_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={device === value}
              onClick={() => {
                setDevice(value);
                setPage(1);
              }}
              className={cn(
                'whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors',
                device === value
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {canDelete ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    aria-label="Select all keywords on this page"
                    className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                  />
                </TableHead>
              ) : null}
              <SortableHead field="keyword" label="Keyword" />
              {grouped ? (
                <>
                  <TableHead>Desktop</TableHead>
                  <TableHead>Desktop change</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Mobile change</TableHead>
                </>
              ) : (
                <>
                  <SortableHead field="position" label="Position" />
                  <SortableHead field="change" label="Change" />
                  <TableHead>Ranking URL</TableHead>
                </>
              )}
              <SortableHead field="checkedAt" label="Last Checked" />
              {canDelete ? (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No keywords match these filters.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((line) => {
                const lineSelected = line.keywordIds.every((id) => selected.has(id));
                // The most recent of the devices on this line. ISO timestamps
                // sort lexicographically, so the last one is the newest.
                const checkedAt =
                  [line.desktop?.checkedAt, line.mobile?.checkedAt]
                    .filter((value): value is string => Boolean(value))
                    .sort()
                    .pop() ?? null;

                return (
                  <TableRow key={line.key} data-selected={lineSelected ? '' : undefined}>
                    {canDelete ? (
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={lineSelected}
                          onChange={() => toggleLine(line.keywordIds)}
                          aria-label={`Select ${line.keyword}`}
                          className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="max-w-[22rem]">
                      <p className="truncate font-medium">{line.keyword}</p>
                      {line.targetUrl ? (
                        <p className="truncate text-xs text-muted-foreground">
                          Target: {line.targetUrl}
                        </p>
                      ) : null}
                      {showLocation ? (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                          {locationLabel(line.country, line.city)}
                        </p>
                      ) : null}
                    </TableCell>

                    {grouped ? (
                      <>
                        <DeviceCells row={line.desktop} />
                        <DeviceCells row={line.mobile} />
                      </>
                    ) : (
                      <>
                        <TableCell>
                          <PositionCell position={line.single?.position ?? null} />
                        </TableCell>
                        <TableCell>
                          <ChangeCell
                            kind={line.single?.changeKind ?? 'none'}
                            label={line.single?.changeLabel ?? '—'}
                          />
                        </TableCell>
                        <TableCell className="max-w-[20rem]">
                          {line.single?.rankingUrl ? (
                            <a
                              href={line.single.rankingUrl}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline"
                              title={line.single.rankingUrl}
                            >
                              <span className="truncate">{displayUrl(line.single.rankingUrl)}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </>
                    )}

                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {checkedAt ? (
                        formatRelativeDay(checkedAt)
                      ) : (
                        <Badge variant="outline">Never</Badge>
                      )}
                    </TableCell>

                    {canDelete ? (
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => {
                            setRowTarget({ keyword: line.keyword, ids: line.keywordIds });
                            setDeleteError(null);
                            setConfirming('row');
                          }}
                          aria-label={`Delete ${line.keyword}`}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {canDelete && selected.size > 0 && totalPages > 1 ? (
        <p className="text-xs text-muted-foreground">
          Select-all covers this page only. {selected.size} keyword
          {selected.size === 1 ? '' : 's'} selected so far.
        </p>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {safePage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) {
            setConfirming(null);
            setRowTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirming === 'bulk'
                ? `Delete ${selected.size} keyword${selected.size === 1 ? '' : 's'}?`
                : 'Delete this keyword?'}
            </DialogTitle>
            <DialogDescription>
              {confirming === 'bulk' ? (
                <>
                  The selected keywords and every position ever recorded for them will be
                  deleted permanently. This cannot be undone.
                </>
              ) : (
                <>
                  <strong className="text-foreground">{rowTarget?.keyword}</strong>
                  {rowTarget && rowTarget.ids.length > 1
                    ? ' — on both desktop and mobile — and its'
                    : ' and its'}{' '}
                  entire position history will be deleted permanently — not just removed from
                  future checks. This cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {deleteError ? <Alert tone="error">{deleteError}</Alert> : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(null);
                setRowTarget(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (confirming === 'bulk') void deleteSelected();
                else if (rowTarget) void deleteLine(rowTarget.ids, rowTarget.keyword);
              }}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
