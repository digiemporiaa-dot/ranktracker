import 'server-only';

import { env, hasDataForSeoCredentials } from '@/lib/env';
import { logger } from '@/lib/logger';
import { hostMatchesDomain, hostnameFromUrl, normalizeDomain } from '@/lib/domain';
import {
  getCountry,
  getLanguage,
  toDataForSeoDevice,
  type CountryCode,
  type DeviceCode,
  type LanguageCode,
} from '@/config/serp';

/**
 * Direct DataForSEO SERP integration.
 *
 * The browser never talks to DataForSEO and never receives these credentials —
 * this module is server-only and there is no proxy route in front of it.
 *
 * Endpoint: POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced
 * Auth:     HTTP Basic (login:password)
 * Body:     an array of task objects; the live endpoint accepts one task.
 */

const API_BASE = 'https://api.dataforseo.com';
const LIVE_ADVANCED_PATH = '/v3/serp/google/organic/live/advanced';
const LOCATIONS_PATH = '/v3/serp/google/locations';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

/** DataForSEO status codes in the 20000 range mean success. */
const OK_STATUS_MIN = 20000;
const OK_STATUS_MAX = 29999;

export class DataForSeoError extends Error {
  /** Whether retrying this exact request could plausibly succeed. */
  readonly retryable: boolean;
  /** Message that is safe to show an end user. */
  readonly userMessage: string;
  readonly statusCode?: number;

  constructor(opts: {
    message: string;
    retryable: boolean;
    userMessage?: string;
    statusCode?: number;
  }) {
    super(opts.message);
    this.name = 'DataForSeoError';
    this.retryable = opts.retryable;
    this.statusCode = opts.statusCode;
    this.userMessage =
      opts.userMessage ?? 'Unable to check this keyword right now. Please try again.';
  }
}

export class DataForSeoNotConfiguredError extends DataForSeoError {
  constructor() {
    super({
      message: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not configured',
      retryable: false,
      userMessage:
        'Ranking checks are not available because the SERP provider is not configured. Add your DataForSEO credentials to the server environment.',
    });
    this.name = 'DataForSeoNotConfiguredError';
  }
}

function authHeader(): string {
  const token = Buffer.from(
    `${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`,
    'utf8',
  ).toString('base64');
  return `Basic ${token}`;
}

/** A single organic result, already reduced to what we store. */
export type OrganicResult = {
  /** 1-based position counting organic results only (ads excluded). */
  position: number;
  url: string;
  domain: string;
  title: string | null;
};

export type SerpResponse = {
  organic: OrganicResult[];
  /** How many organic results were returned. */
  organicCount: number;
  /** True when this came from the cache rather than a fresh provider call. */
  cached: boolean;
};

export type RankingLookup = {
  keyword: string;
  domain: string;
  country: CountryCode;
  language: LanguageCode;
  device: DeviceCode;
  results: number;
};

export type RankingResult = {
  position: number | null;
  rankingUrl: string | null;
  resultsChecked: number;
};

type RawItem = {
  type?: unknown;
  rank_absolute?: unknown;
  rank_group?: unknown;
  url?: unknown;
  domain?: unknown;
  title?: unknown;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableHttpStatus(status: number): boolean {
  // 401/402/403 are credential or billing problems: retrying will not help.
  // 400/422 mean the request itself is wrong.
  return status === 408 || status === 429 || status >= 500;
}

function userMessageForHttpStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'The SERP provider rejected our credentials. Please check the server configuration.';
  }
  if (status === 402) {
    return 'The SERP provider account is out of credit. Please top it up and try again.';
  }
  if (status === 429) {
    return 'The SERP provider is rate limiting us. Please try again in a few minutes.';
  }
  return 'Unable to check this keyword right now. Please try again.';
}

async function callDataForSeo<T>(
  path: string,
  body: unknown | null,
  requestId: string,
): Promise<T> {
  if (!hasDataForSeoCredentials()) throw new DataForSeoNotConfiguredError();

  let lastError: DataForSeoError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: body === null ? 'GET' : 'POST',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
        },
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });

      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const retryable = isRetryableHttpStatus(response.status);
        logger.warn('dataforseo http error', {
          requestId,
          path,
          status: response.status,
          durationMs,
          attempt,
          retryable,
        });
        lastError = new DataForSeoError({
          message: `DataForSEO responded with HTTP ${response.status}`,
          retryable,
          userMessage: userMessageForHttpStatus(response.status),
          statusCode: response.status,
        });
        if (!retryable) throw lastError;
      } else {
        const payload = (await response.json()) as {
          status_code?: number;
          status_message?: string;
        };

        const statusCode = Number(payload?.status_code ?? 0);
        if (statusCode < OK_STATUS_MIN || statusCode > OK_STATUS_MAX) {
          // 40xxx = client/auth errors (do not retry), 50xxx = provider errors.
          const retryable = statusCode >= 50000;
          logger.warn('dataforseo api error', {
            requestId,
            path,
            status: statusCode,
            durationMs,
            attempt,
            retryable,
          });
          lastError = new DataForSeoError({
            message: `DataForSEO API status ${statusCode}: ${payload?.status_message ?? 'unknown'}`,
            retryable,
            userMessage:
              statusCode === 40200 || statusCode === 40100
                ? 'The SERP provider rejected our credentials or the account has no credit.'
                : 'Unable to check this keyword right now. Please try again.',
            statusCode,
          });
          if (!retryable) throw lastError;
        } else {
          logger.debug('dataforseo ok', {
            requestId,
            path,
            status: statusCode,
            durationMs,
            attempt,
          });
          return payload as T;
        }
      }
    } catch (error) {
      if (error instanceof DataForSeoError) {
        if (!error.retryable) throw error;
        lastError = error;
      } else {
        const aborted = error instanceof Error && error.name === 'AbortError';
        logger.warn('dataforseo transport error', {
          requestId,
          path,
          attempt,
          durationMs: Date.now() - startedAt,
          error,
        });
        // Network faults and timeouts are transient.
        lastError = new DataForSeoError({
          message: aborted ? 'DataForSEO request timed out' : 'DataForSEO request failed',
          retryable: true,
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_ATTEMPTS) {
      // Exponential backoff with jitter: ~1s, ~2s.
      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(backoff + Math.floor(Math.random() * 250));
    }
  }

  throw (
    lastError ??
    new DataForSeoError({ message: 'DataForSEO request failed', retryable: true })
  );
}

/**
 * Extract organic results from a DataForSEO live/advanced response.
 *
 * Positions are computed from the organic items only, in SERP order. Ads,
 * shopping units, and every other paid or non-organic element are dropped
 * before numbering, so the first organic result is always #1.
 */
export function extractOrganicResults(payload: unknown): OrganicResult[] {
  const tasks = (payload as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return [];

  const result = (tasks[0] as { result?: unknown })?.result;
  if (!Array.isArray(result) || result.length === 0) return [];

  const items = (result[0] as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const organic = (items as RawItem[])
    .filter((item) => item && item.type === 'organic')
    .map((item) => {
      const url = typeof item.url === 'string' ? item.url : '';
      const rankAbsolute = Number(item.rank_absolute);
      const rankGroup = Number(item.rank_group);
      return {
        url,
        domain:
          typeof item.domain === 'string' && item.domain
            ? item.domain.toLowerCase()
            : (hostnameFromUrl(url) ?? ''),
        title: typeof item.title === 'string' ? item.title : null,
        // Preserve SERP order. rank_absolute counts every SERP element; when it
        // is missing we fall back to rank_group, then to array order.
        sortKey: Number.isFinite(rankAbsolute)
          ? rankAbsolute
          : Number.isFinite(rankGroup)
            ? rankGroup
            : Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((item) => item.url.length > 0);

  organic.sort((a, b) => a.sortKey - b.sortKey);

  return organic.map((item, index) => ({
    position: index + 1,
    url: item.url,
    domain: item.domain,
    title: item.title,
  }));
}

/**
 * Find a domain's best position among organic results.
 *
 * When the domain appears more than once, the best (lowest) position wins and
 * its URL is reported.
 */
export function findDomainPosition(
  organic: OrganicResult[],
  domain: string,
): { position: number | null; rankingUrl: string | null } {
  const target = normalizeDomain(domain);
  if (!target) return { position: null, rankingUrl: null };

  for (const result of organic) {
    const host = hostnameFromUrl(result.url) ?? result.domain;
    if (host && hostMatchesDomain(host, target)) {
      return { position: result.position, rankingUrl: result.url };
    }
  }

  return { position: null, rankingUrl: null };
}

/** Build the live/advanced request body for one keyword. */
export function buildSerpTask(lookup: RankingLookup) {
  const country = getCountry(lookup.country);
  const language = getLanguage(lookup.language);

  return {
    keyword: lookup.keyword,
    location_code: country.locationCode,
    language_code: language.languageCode,
    device: toDataForSeoDevice(lookup.device),
    os: lookup.device === 'MOBILE' ? 'android' : 'windows',
    depth: lookup.results,
    se_domain: 'google.com',
  };
}

/** Fetch a SERP from DataForSEO. No caching — see `serp.ts` for the cached path. */
export async function fetchSerp(
  lookup: RankingLookup,
  requestId: string,
): Promise<OrganicResult[]> {
  const task = buildSerpTask(lookup);
  const payload = await callDataForSeo<unknown>(LIVE_ADVANCED_PATH, [task], requestId);
  return extractOrganicResults(payload);
}

/**
 * The one function the rest of the app calls to rank a keyword.
 * Returns only what we store — never the raw provider response.
 */
export async function checkKeywordRanking(
  lookup: RankingLookup,
  organicOverride?: OrganicResult[],
  requestId = 'no-request-id',
): Promise<RankingResult> {
  const organic = organicOverride ?? (await fetchSerp(lookup, requestId));
  const { position, rankingUrl } = findDomainPosition(organic, lookup.domain);
  return { position, rankingUrl, resultsChecked: organic.length };
}

/** Country locations reported by DataForSEO, used by the verification script. */
export async function fetchCountryLocations(
  requestId = 'locations',
): Promise<{ location_code: number; location_name: string; country_iso_code?: string; location_type?: string }[]> {
  const payload = await callDataForSeo<{
    tasks?: { result?: unknown[] }[];
  }>(LOCATIONS_PATH, null, requestId);

  const result = payload?.tasks?.[0]?.result;
  if (!Array.isArray(result)) return [];
  return result as { location_code: number; location_name: string }[];
}
