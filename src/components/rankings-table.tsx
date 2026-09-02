'use client';

import { useMemo, useState } from 'react';
import { ArrowDownUp, ExternalLink, Search } from 'lucide-react';

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
export function RankingsTable({ rows }: { rows: RankingRow[] }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RankingFilter>('all');
  const [sort, setSort] = useState<SortField>('position');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const result = rows.filter((row) => {
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
  }, [rows, search, filter, sort, direction]);

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
        <p className="text-sm text-muted-foreground">
          {filtered.length} of {rows.length} keyword{rows.length === 1 ? '' : 's'}
        </p>
      </div>

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
              <SortableHead field="keyword" label="Keyword" />
              <SortableHead field="position" label="Position" />
              <SortableHead field="change" label="Change" />
              <TableHead>Ranking URL</TableHead>
              <SortableHead field="checkedAt" label="Last Checked" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No keywords match these filters.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow key={row.id}>
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
    </div>
  );
}
