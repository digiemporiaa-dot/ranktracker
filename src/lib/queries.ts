import 'server-only';

import { prisma } from '@/lib/db';
import {
  calculatePositionChange,
  calculateStats,
  matchesDevice,
  matchesFilter,
  type ChangeKind,
  type DeviceFilter,
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
  city: string | null;
  locationCode: number;
  googleDomain: string;
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
      k."city",
      k."locationCode",
      k."googleDomain",
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
    locationCode: Number(row.locationCode),
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
    device?: DeviceFilter;
  },
): RankingTableRow[] {
  const {
    search,
    filter = 'all',
    sort = 'position',
    direction = 'asc',
    device = 'all',
  } = options;

  let out = matchesDevice(rows, device);

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

/**
 * Shape the rows the way the browser table wants them.
 *
 * Dates become ISO strings, and the device and location travel with each row —
 * the table needs both to keep desktop and mobile apart and to say which
 * location a position was measured in.
 */
export function toTableRows(rows: RankingTableRow[]) {
  return rows.map((row) => ({
    id: row.id,
    keyword: row.keyword,
    targetUrl: row.targetUrl,
    device: row.device,
    country: row.country,
    city: row.city,
    locationCode: row.locationCode,
    language: row.language,
    position: row.position,
    rankingUrl: row.rankingUrl,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    previousPosition: row.previousPosition,
    changeKind: row.changeKind,
    changeDelta: row.changeDelta,
    changeLabel: row.changeLabel,
  }));
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
