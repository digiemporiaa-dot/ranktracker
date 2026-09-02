import 'server-only';

import { prisma } from '@/lib/db';
import {
  calculatePositionChange,
  calculateStats,
  matchesFilter,
  type ChangeKind,
  type RankingFilter,
  type RankingStats,
} from '@/lib/ranking';

/**
 * A keyword with just its latest and previous ranking.
 *
 * The full ranking history is never loaded for a listing — the LATERAL joins
 * below fetch exactly two rows per keyword.
 */
export type KeywordRow = {
  id: string;
  keyword: string;
  targetUrl: string | null;
  country: string;
  language: string;
  device: string;
  active: boolean;
  position: number | null;
  rankingUrl: string | null;
  checkedAt: Date | null;
  previousPosition: number | null;
  previousCheckedAt: Date | null;
};

type RawKeywordRow = Omit<KeywordRow, 'position' | 'previousPosition'> & {
  position: number | null;
  previousPosition: number | null;
};

export async function getKeywordRows(projectId: string): Promise<KeywordRow[]> {
  const rows = await prisma.$queryRaw<RawKeywordRow[]>`
    SELECT
      k."id",
      k."keyword",
      k."targetUrl",
      k."country",
      k."language",
      k."device"::text AS "device",
      k."active",
      latest."position"           AS "position",
      latest."rankingUrl"         AS "rankingUrl",
      latest."checkedAt"          AS "checkedAt",
      previous."position"         AS "previousPosition",
      previous."checkedAt"        AS "previousCheckedAt"
    FROM "Keyword" k
    LEFT JOIN LATERAL (
      SELECT r."position", r."rankingUrl", r."checkedAt"
      FROM "Ranking" r
      WHERE r."keywordId" = k."id"
      ORDER BY r."checkedAt" DESC, r."id" DESC
      LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT r."position", r."checkedAt"
      FROM "Ranking" r
      WHERE r."keywordId" = k."id"
      ORDER BY r."checkedAt" DESC, r."id" DESC
      OFFSET 1
      LIMIT 1
    ) previous ON TRUE
    WHERE k."projectId" = ${projectId}
    ORDER BY k."createdAt" ASC
  `;

  return rows.map((row) => ({
    ...row,
    position: row.position === null ? null : Number(row.position),
    previousPosition: row.previousPosition === null ? null : Number(row.previousPosition),
  }));
}

export type RankingTableRow = KeywordRow & {
  changeKind: ChangeKind;
  changeDelta: number | null;
  changeLabel: string;
};

export type SortField = 'keyword' | 'position' | 'change' | 'checkedAt';

export function decorate(rows: KeywordRow[]): RankingTableRow[] {
  return rows.map((row) => {
    const change = calculatePositionChange(row.position, row.previousPosition);
    return {
      ...row,
      changeKind: change.kind,
      changeDelta: change.delta,
      changeLabel: change.label,
    };
  });
}

export function applyFilters(
  rows: RankingTableRow[],
  options: {
    search?: string;
    filter?: RankingFilter;
    sort?: SortField;
    direction?: 'asc' | 'desc';
  },
): RankingTableRow[] {
  const { search, filter = 'all', sort = 'position', direction = 'asc' } = options;

  let out = rows;

  if (search && search.trim()) {
    const needle = search.trim().toLowerCase();
    out = out.filter((row) => row.keyword.toLowerCase().includes(needle));
  }

  if (filter !== 'all') {
    out = out.filter((row) => matchesFilter(filter, row.position, row.changeKind));
  }

  const sign = direction === 'desc' ? -1 : 1;

  out = [...out].sort((a, b) => {
    switch (sort) {
      case 'keyword':
        return sign * a.keyword.localeCompare(b.keyword);
      case 'change': {
        // Unranked/unchanged rows sort last regardless of direction.
        const av = a.changeDelta ?? (a.changeKind === 'new' ? Number.MAX_SAFE_INTEGER : 0);
        const bv = b.changeDelta ?? (b.changeKind === 'new' ? Number.MAX_SAFE_INTEGER : 0);
        return -sign * (av - bv);
      }
      case 'checkedAt': {
        const av = a.checkedAt ? a.checkedAt.getTime() : 0;
        const bv = b.checkedAt ? b.checkedAt.getTime() : 0;
        return -sign * (av - bv);
      }
      case 'position':
      default: {
        // "Not Found" always sorts to the bottom.
        const av = a.position ?? Number.MAX_SAFE_INTEGER;
        const bv = b.position ?? Number.MAX_SAFE_INTEGER;
        return sign * (av - bv);
      }
    }
  });

  return out;
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

export type ProjectOverview = {
  stats: RankingStats;
  lastCheckedAt: Date | null;
};

export function summarize(rows: KeywordRow[]): ProjectOverview {
  const stats = calculateStats(
    rows.map((row) => ({ position: row.position, previousPosition: row.previousPosition })),
  );

  const lastCheckedAt = rows.reduce<Date | null>((latest, row) => {
    if (!row.checkedAt) return latest;
    if (!latest || row.checkedAt > latest) return row.checkedAt;
    return latest;
  }, null);

  return { stats, lastCheckedAt };
}
