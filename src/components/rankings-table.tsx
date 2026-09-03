'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownUp, ExternalLink, Loader2, Search, Trash2 } from 'lucide-react';

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
import { RANKING_FILTERS, matchesFilter, type ChangeKind, type RankingFilter } from '@/lib/ranking';
import { cn, displayUrl, formatRelativeDay } from '@/lib/utils';

export type RankingRow = {
  id: string;
  keyword: string;
  targetUrl: string | null;
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
  const [rowTarget, setRowTarget] = useState<RankingRow | null>(null);
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
  const [sort, setSort] = useState<SortField>('position');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const result = rows.filter((row) => {
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
  }, [rows, removed, search, filter, sort, direction]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sort === field) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setDirection(field === 'keyword' || field === 'position' ? 'asc' : 'desc');
    }
    setPage(1);
  }

  const visibleIds = visible.map((row) => row.id);
  const allOnPageSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
  async function runDelete(ids: string[], request: () => Promise<Response>) {
    if (!projectId || ids.length === 0) return;

    setDeleteError(null);
    setDeleting(true);
    setRemoved((current) => new Set([...current, ...ids]));

    try {
      const response = await request();
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setRemoved((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        setDeleteError(data.error ?? 'That could not be deleted. Please try again.');
        return;
      }

      const deleted = typeof data.deleted === 'number' ? data.deleted : ids.length;

      // Report a partial result honestly rather than claiming full success.
      toast(
        deleted === ids.length
          ? `Deleted ${deleted} keyword${deleted === 1 ? '' : 's'}`
          : `Deleted ${deleted} of ${ids.length} keywords`,
      );

      setConfirming(null);
      setRowTarget(null);
      setSelected(new Set());
      router.refresh();
    } catch {
      setRemoved((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteError('We could not reach the server. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  const deleteRow = (row: RankingRow) =>
    runDelete([row.id], () =>
      fetch(`/api/projects/${projectId}/keywords?keywordId=${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      }),
    );

  const deleteSelected = () => {
    const ids = [...selected];
    return runDelete(ids, () =>
      fetch(`/api/projects/${projectId}/keywords/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywordIds: ids }),
      }),
    );
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
            {filtered.length} of {rows.length} keyword{rows.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {deleteError && !confirming ? <Alert tone="error">{deleteError}</Alert> : null}

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

      <div className="overflow-hidden rounded-xl border border-border bg-card">
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
              <SortableHead field="position" label="Position" />
              <SortableHead field="change" label="Change" />
              <TableHead>Ranking URL</TableHead>
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
                  colSpan={canDelete ? 7 : 5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No keywords match these filters.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow key={row.id} data-selected={selected.has(row.id) ? '' : undefined}>
                  {canDelete ? (
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label={`Select ${row.keyword}`}
                        className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="max-w-[22rem]">
                    <p className="truncate font-medium">{row.keyword}</p>
                    {row.targetUrl ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Target: {row.targetUrl}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <PositionCell position={row.position} />
                  </TableCell>
                  <TableCell>
                    <ChangeCell kind={row.changeKind} label={row.changeLabel} />
                  </TableCell>
                  <TableCell className="max-w-[20rem]">
                    {row.rankingUrl ? (
                      <a
                        href={row.rankingUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline"
                        title={row.rankingUrl}
                      >
                        <span className="truncate">{displayUrl(row.rankingUrl)}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.checkedAt ? formatRelativeDay(row.checkedAt) : <Badge variant="outline">Never</Badge>}
                  </TableCell>
                  {canDelete ? (
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => {
                          setRowTarget(row);
                          setDeleteError(null);
                          setConfirming('row');
                        }}
                        aria-label={`Delete ${row.keyword}`}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
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
                  <strong className="text-foreground">{rowTarget?.keyword}</strong> and its
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
                else if (rowTarget) void deleteRow(rowTarget);
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
