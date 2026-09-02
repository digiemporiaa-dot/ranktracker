import Papa from 'papaparse';

import { normalizeTargetUrl } from '@/lib/domain';

/** Hard limits, enforced on both the client preview and the server import. */
export const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_KEYWORDS_PER_IMPORT = 5000;
export const MAX_KEYWORD_LENGTH = 255;

export type ParsedKeyword = {
  keyword: string;
  targetUrl: string | null;
};

export type CsvParseResult = {
  keywords: ParsedKeyword[];
  /** Rows dropped because they were blank or had no keyword. */
  skippedRows: number;
  /** Rows dropped because the keyword already appeared earlier. */
  duplicates: number;
  /** Rows dropped because they exceeded the keyword cap. */
  truncated: number;
  errors: string[];
};

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@']);

/**
 * Neutralize spreadsheet formula injection.
 *
 * A cell starting with = + - @ or a control character is executed as a formula
 * by Excel / Sheets / LibreOffice. Prefixing with a single quote makes the cell
 * literal text. Applied on the way in (stored keywords) and on the way out
 * (CSV export).
 */
export function sanitizeCsvValue(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value;
  // Strip leading control characters and spaces, which can be used to smuggle
  // a trigger character past a naive check.
  let start = 0;
  while (start < value.length) {
    const code = value.charCodeAt(start);
    if (code <= 0x20 || code === 0x7f) start += 1;
    else break;
  }
  const cleaned = value.slice(start);
  if (FORMULA_TRIGGERS.has(cleaned[0])) return `'${cleaned}`;
  return cleaned;
}

/** Collapse internal whitespace and trim. */
function normalizeKeyword(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function findColumn(fields: string[], candidates: string[]): string | null {
  for (const field of fields) {
    const normalized = field.trim().toLowerCase().replace(/[\s_-]/g, '');
    if (candidates.includes(normalized)) return field;
  }
  return null;
}

/**
 * Parse a keyword CSV.
 *
 * Accepts either a bare `keyword` column, or `keyword` + `targetUrl` (also
 * spelled `target_url` / `target url` / `url`). A headerless single-column file
 * is treated as a plain list of keywords.
 */
export function parseKeywordCsv(
  input: string,
  options: { maxKeywords?: number } = {},
): CsvParseResult {
  const maxKeywords = options.maxKeywords ?? MAX_KEYWORDS_PER_IMPORT;
  const result: CsvParseResult = {
    keywords: [],
    skippedRows: 0,
    duplicates: 0,
    truncated: 0,
    errors: [],
  };

  const raw = String(input ?? '');
  const text = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).trim();

  if (!text) {
    result.errors.push('The file is empty.');
    return result;
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const fields = (parsed.meta.fields ?? []).filter(Boolean);
  const keywordColumn = findColumn(fields, ['keyword', 'keywords', 'query', 'term']);

  // No recognizable header: fall back to treating a single column as keywords.
  if (!keywordColumn) {
    if (fields.length === 1) {
      const rows = [fields[0], ...parsed.data.map((row) => row[fields[0]] ?? '')];
      return collectKeywords(
        rows.map((value) => ({ keyword: value, targetUrl: null })),
        maxKeywords,
        result,
      );
    }
    result.errors.push(
      'Could not find a "keyword" column. Add a header row containing a "keyword" column.',
    );
    return result;
  }

  const targetColumn = findColumn(fields, ['targeturl', 'target', 'url', 'landingpage']);

  const rows = parsed.data.map((row) => ({
    keyword: row[keywordColumn] ?? '',
    targetUrl: targetColumn ? (row[targetColumn] ?? null) : null,
  }));

  return collectKeywords(rows, maxKeywords, result);
}

function collectKeywords(
  rows: { keyword: string; targetUrl: string | null }[],
  maxKeywords: number,
  result: CsvParseResult,
): CsvParseResult {
  const seen = new Set<string>();

  for (const row of rows) {
    const keyword = normalizeKeyword(String(row.keyword ?? ''));
    if (!keyword) {
      result.skippedRows += 1;
      continue;
    }
    if (keyword.length > MAX_KEYWORD_LENGTH) {
      result.skippedRows += 1;
      result.errors.push(`Skipped a keyword longer than ${MAX_KEYWORD_LENGTH} characters.`);
      continue;
    }

    const dedupeKey = keyword.toLowerCase();
    if (seen.has(dedupeKey)) {
      result.duplicates += 1;
      continue;
    }

    if (result.keywords.length >= maxKeywords) {
      result.truncated += 1;
      continue;
    }

    seen.add(dedupeKey);
    result.keywords.push({
      keyword: sanitizeCsvValue(keyword),
      targetUrl: normalizeTargetUrl(row.targetUrl ? String(row.targetUrl).trim() : null),
    });
  }

  if (result.keywords.length === 0 && result.errors.length === 0) {
    result.errors.push('No valid keywords were found.');
  }
  if (result.truncated > 0) {
    result.errors.push(
      `Only the first ${maxKeywords} keywords were kept; ${result.truncated} more were ignored.`,
    );
  }

  return result;
}

/**
 * Parse a pasted keyword list — one keyword per line.
 * Blank lines, surrounding whitespace and duplicates are removed.
 */
export function parseKeywordList(
  input: string,
  options: { maxKeywords?: number } = {},
): CsvParseResult {
  const maxKeywords = options.maxKeywords ?? MAX_KEYWORDS_PER_IMPORT;
  const rows = String(input ?? '')
    .split(/\r?\n/)
    .map((line) => ({ keyword: line, targetUrl: null }));

  const result: CsvParseResult = {
    keywords: [],
    skippedRows: 0,
    duplicates: 0,
    truncated: 0,
    errors: [],
  };

  return collectKeywords(rows, maxKeywords, result);
}

/** Serialize rows to CSV with every cell escaped and de-fanged. */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escapeCell = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const asString = sanitizeCsvValue(String(value));
    if (/[",\r\n]/.test(asString)) return `"${asString.replace(/"/g, '""')}"`;
    return asString;
  };

  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
