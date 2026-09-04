/**
 * Position-change arithmetic.
 *
 * `null` means "not found in the checked results" and is displayed as
 * "Not Found". A move toward #1 is an improvement, so change is
 * `previous - current` (10 -> 5 is +5).
 */

export type ChangeKind = 'up' | 'down' | 'same' | 'new' | 'lost' | 'none';

export type PositionChange = {
  kind: ChangeKind;
  /** Positive = improved, negative = dropped, 0 = unchanged, null otherwise. */
  delta: number | null;
  label: string;
};

export function calculatePositionChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): PositionChange {
  const cur = typeof current === 'number' ? current : null;
  const prev = typeof previous === 'number' ? previous : null;

  // No previous check at all, or still not ranking: nothing to compare.
  if (prev === null && cur === null) return { kind: 'none', delta: null, label: '—' };

  if (prev === null && cur !== null) return { kind: 'new', delta: null, label: 'New' };

  if (prev !== null && cur === null) return { kind: 'lost', delta: null, label: 'Lost' };

  const delta = (prev as number) - (cur as number);
  if (delta === 0) return { kind: 'same', delta: 0, label: '—' };
  if (delta > 0) return { kind: 'up', delta, label: `↑ ${delta}` };
  return { kind: 'down', delta, label: `↓ ${Math.abs(delta)}` };
}

/** Human-readable position for tables and exports. */
export function formatPosition(position: number | null | undefined): string {
  return typeof position === 'number' ? `#${position}` : 'Not Found';
}

export type RankingStats = {
  totalKeywords: number;
  top3: number;
  top10: number;
  top20: number;
  top50: number;
  top100: number;
  notRanking: number;
  improved: number;
  dropped: number;
  averagePosition: number | null;
};

export type StatsInput = {
  position: number | null;
  previousPosition: number | null;
}[];

/** All dashboard statistics, computed from the rows — never hardcoded. */
export function calculateStats(rows: StatsInput): RankingStats {
  const stats: RankingStats = {
    totalKeywords: rows.length,
    top3: 0,
    top10: 0,
    top20: 0,
    top50: 0,
    top100: 0,
    notRanking: 0,
    improved: 0,
    dropped: 0,
    averagePosition: null,
  };

  let rankedSum = 0;
  let rankedCount = 0;

  for (const row of rows) {
    const { position } = row;
    if (position === null) {
      stats.notRanking += 1;
    } else {
      if (position <= 3) stats.top3 += 1;
      if (position <= 10) stats.top10 += 1;
      if (position <= 20) stats.top20 += 1;
      if (position <= 50) stats.top50 += 1;
      if (position <= 100) stats.top100 += 1;
      rankedSum += position;
      rankedCount += 1;
    }

    const change = calculatePositionChange(position, row.previousPosition);
    if (change.kind === 'up' || change.kind === 'new') stats.improved += 1;
    if (change.kind === 'down' || change.kind === 'lost') stats.dropped += 1;
  }

  stats.averagePosition =
    rankedCount > 0 ? Math.round((rankedSum / rankedCount) * 10) / 10 : null;

  return stats;
}

export type RankingFilter =
  | 'all'
  | 'top3'
  | 'top10'
  | 'top20'
  | 'top50'
  | 'top100'
  | 'notRanking'
  | 'improved'
  | 'dropped';

export const RANKING_FILTERS: { value: RankingFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'top3', label: 'Top 3' },
  { value: 'top10', label: 'Top 10' },
  { value: 'top20', label: 'Top 20' },
  { value: 'top50', label: 'Top 50' },
  { value: 'top100', label: 'Top 100' },
  { value: 'notRanking', label: 'Not Ranking' },
  { value: 'improved', label: 'Improved' },
  { value: 'dropped', label: 'Dropped' },
];

export function matchesFilter(
  filter: RankingFilter,
  position: number | null,
  changeKind: ChangeKind,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'top3':
      return position !== null && position <= 3;
    case 'top10':
      return position !== null && position <= 10;
    case 'top20':
      return position !== null && position <= 20;
    case 'top50':
      return position !== null && position <= 50;
    case 'top100':
      return position !== null && position <= 100;
    case 'notRanking':
      return position === null;
    case 'improved':
      return changeKind === 'up' || changeKind === 'new';
    case 'dropped':
      return changeKind === 'down' || changeKind === 'lost';
    default:
      return true;
  }
}

/* -------------------------------------------------------------------------
 * Devices
 *
 * Desktop and mobile are tracked as separate keyword rows with separate
 * histories. Nothing below ever averages, merges or falls back between them —
 * a keyword with no mobile row shows no mobile position, rather than borrowing
 * the desktop one.
 * ---------------------------------------------------------------------- */

export type DeviceFilter = 'all' | 'DESKTOP' | 'MOBILE';

export const DEVICE_FILTERS: { value: DeviceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'DESKTOP', label: 'Desktop' },
  { value: 'MOBILE', label: 'Mobile' },
];

export function isDeviceFilter(value: string): value is DeviceFilter {
  return value === 'all' || value === 'DESKTOP' || value === 'MOBILE';
}

/** Narrow a list of per-device rows to one device. 'all' keeps everything. */
export function matchesDevice<T extends { device: string }>(
  rows: T[],
  device: DeviceFilter,
): T[] {
  if (device === 'all') return rows;
  return rows.filter((row) => row.device === device);
}

/** What identifies one line of the desktop-and-mobile table. */
type Groupable = {
  id: string;
  keyword: string;
  locationCode: number;
  language: string;
  device: string;
};

export type DeviceGroup<T extends Groupable> = {
  /** Stable across renders; not a database id. */
  key: string;
  keyword: string;
  locationCode: number;
  language: string;
  desktop: T | null;
  mobile: T | null;
  /** The rows behind this line — one per device actually tracked. */
  keywordIds: string[];
};

/**
 * Pivot per-device rows into one line per keyword, so desktop and mobile sit
 * side by side.
 *
 * Rows are grouped by keyword *and location*: the same words tracked in Delhi
 * and nationwide are two different measurements and stay two different lines.
 * Order follows the first appearance of each group, which keeps whatever
 * ordering the caller already applied.
 */
export function groupByDevice<T extends Groupable>(rows: T[]): DeviceGroup<T>[] {
  const groups = new Map<string, DeviceGroup<T>>();

  for (const row of rows) {
    const key = `${row.locationCode}|${row.language}|${row.keyword}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        keyword: row.keyword,
        locationCode: row.locationCode,
        language: row.language,
        desktop: null,
        mobile: null,
        keywordIds: [],
      };
      groups.set(key, group);
    }

    if (row.device === 'MOBILE') group.mobile = row;
    else group.desktop = row;

    group.keywordIds.push(row.id);
  }

  return [...groups.values()];
}
