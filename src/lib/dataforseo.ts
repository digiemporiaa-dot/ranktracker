import 'server-only';

import { env, hasDataForSeoCredentials } from '@/lib/env';
import { logger } from '@/lib/logger';
import { hostMatchesDomain, hostnameFromUrl, normalizeDomain } from '@/lib/domain';
import {
  getLanguage,
  normalizeDepth,
  toDataForSeoDevice,
  type CountryCode,
  type DeviceCode,
  type LanguageCode,
  type SerpStatus,
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
 *
 * A v3 response has two levels of status and they mean different things:
 *
 *   { status_code: 20000,            <- did the *request* succeed
 *     tasks: [ { status_code: 40102, <- did *this task* produce a SERP
 *                result: [ { items: null, items_count: 0 } ] } ] }
 *
 * The task level is the one that says whether there is a SERP to read, so
 * both are inspected below. A task that carries no items is never read as
 * "the domain does not rank" — see `classifySerpPayload`.
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

/**
 * Task statuses that mean "no SERP was produced", not "the request was wrong".
 *
 * 40102 "No Search Results." is what Google-returned-nothing looks like. It is
 * charged for and it is frequently transient, so it is retried rather than
 * treated as an error or, worse, as a ranking of zero.
 */
export const EMPTY_SERP_STATUS_CODES = new Set([40102]);

/**
 * Waits between retries of an empty SERP, in order: attempt 1 fails, wait 2s;
 * attempt 2 fails, wait 5s; attempt 3 fails, wait 10s. If the retry count is
 * configured higher than this table, the last wait repeats.
 */
export const EMPTY_SERP_BACKOFF_MS = [2_000, 5_000, 10_000];

/** Top-level SERP item types that are never an organic ranking position. */
const NON_ORGANIC_ITEM_TYPES = [
  'ai_overview',
  'people_also_ask',
  'related_searches',
  'paid',
  'shopping',
  'featured_snippet',
  'local_pack',
  'knowledge_graph',
  'video',
  'images',
  'top_stories',
  'twitter',
  'map',
] as const;

export class DataForSeoError extends Error {
  /** Whether retrying this exact request could plausibly succeed. */
  readonly retryable: boolean;
  /** Message that is safe to show an end user. */
  readonly userMessage: string;
  readonly statusCode?: number;
  /** Provider status message, when the failure came from the API itself. */
  readonly apiStatusMessage?: string;

  constructor(opts: {
    message: string;
    retryable: boolean;
    userMessage?: string;
    statusCode?: number;
    apiStatusMessage?: string;
  }) {
    super(opts.message);
    this.name = 'DataForSeoError';
    this.retryable = opts.retryable;
    this.statusCode = opts.statusCode;
    this.apiStatusMessage = opts.apiStatusMessage;
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

export type RankingLookup = {
  keyword: string;
  domain: string;
  country: CountryCode;
  /** Display name of the city, or null for a country-level search. */
  city: string | null;
  /**
   * The DataForSEO location actually searched — a country code, or a city code
   * when one was chosen. Always resolved on the server; never sent by a client.
   */
  locationCode: number;
  /** The Google property searched, e.g. "google.co.in". */
  googleDomain: string;
  language: LanguageCode;
  device: DeviceCode;
  results: number;
};

/**
 * What one (retried) SERP fetch produced.
 *
 * `OK` carries a SERP that was actually read — an empty `organic` array then
 * genuinely means the SERP held no organic results. `SERP_UNAVAILABLE` carries
 * no observation at all and must never be read as a position.
 */
export type SerpFetchOutcome = {
  status: 'OK' | 'SERP_UNAVAILABLE';
  organic: OrganicResult[];
  /** Provider status code of the last attempt, e.g. 20000 or 40102. */
  apiStatusCode: number | null;
  /** Provider status message of the last attempt, e.g. "No Search Results.". */
  apiStatusMessage: string | null;
  /** How many requests were sent, including the first one. */
  attempts: number;
};

export type RankingResult = {
  /** RANKED, NOT_RANKED, SERP_UNAVAILABLE or API_ERROR. Never inferred later. */
  status: SerpStatus;
  /** Null whenever there is no position to report, for any reason. */
  position: number | null;
  rankingUrl: string | null;
  /** Null when no SERP was read — zero would claim we looked and saw nothing. */
  resultsChecked: number | null;
  apiStatusCode: number | null;
  apiStatusMessage: string | null;
  attempts: number;
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

const isOkStatus = (code: number) => code >= OK_STATUS_MIN && code <= OK_STATUS_MAX;

async function callDataForSeo<T>(
  path: string,
  body: unknown | null,
  requestId: string,
  /**
   * Provider statuses to hand back to the caller instead of throwing. Used for
   * 40102, which is an outcome to classify rather than a transport failure.
   */
  softStatusCodes: Set<number> = new Set(),
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

        // A soft status is a real answer, not a failure: return it and let the
        // caller decide what it means.
        if (!isOkStatus(statusCode) && !softStatusCodes.has(statusCode)) {
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
            apiStatusMessage:
              typeof payload?.status_message === 'string' ? payload.status_message : undefined,
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

/* -------------------------------------------------------------------------
 * Response reading
 * ---------------------------------------------------------------------- */

/** The parts of a v3 SERP response the ranking pipeline actually depends on. */
export type SerpPayloadView = {
  /** Task status when there is one, otherwise the envelope status. */
  apiStatusCode: number;
  apiStatusMessage: string;
  /** `items_count` as reported by the provider, or null when absent. */
  itemsCount: number | null;
  /** The SERP items, or null when the task carried none. */
  items: unknown[] | null;
  /**
   * True when the echoed request carried a `target` filter.
   *
   * With `target` set, DataForSEO returns only the results matching it, so an
   * empty SERP means "the target is not in these results" — a measurement —
   * rather than "there is no SERP". This app does not send `target`; the flag
   * exists so a payload produced with one is still read correctly.
   */
  targetFiltered: boolean;
};

/** Pull the status, the items and the echoed request out of a v3 response. */
export function readSerpPayload(payload: unknown): SerpPayloadView {
  const envelope = (payload ?? {}) as { status_code?: unknown; status_message?: unknown; tasks?: unknown };

  let apiStatusCode = Number(envelope.status_code ?? 0);
  let apiStatusMessage =
    typeof envelope.status_message === 'string' ? envelope.status_message : '';

  const task = Array.isArray(envelope.tasks) ? (envelope.tasks[0] as Record<string, unknown>) : null;

  // The task status wins: the envelope says 20000 ("we ran your request") even
  // when the task inside it says 40102 ("...and it produced no SERP").
  if (task && task.status_code !== undefined && task.status_code !== null) {
    apiStatusCode = Number(task.status_code);
    apiStatusMessage =
      typeof task.status_message === 'string' ? task.status_message : apiStatusMessage;
  }

  const data = (task?.data ?? null) as { target?: unknown } | null;
  const targetFiltered =
    typeof data?.target === 'string' && data.target.trim().length > 0;

  const result = Array.isArray(task?.result) ? (task.result as Record<string, unknown>[]) : null;
  const first = result && result.length > 0 ? result[0] : null;

  const rawCount = first?.items_count;
  const itemsCount =
    rawCount === undefined || rawCount === null || Number.isNaN(Number(rawCount))
      ? null
      : Number(rawCount);

  const items = Array.isArray(first?.items) ? (first.items as unknown[]) : null;

  return {
    apiStatusCode: Number.isFinite(apiStatusCode) ? apiStatusCode : 0,
    apiStatusMessage,
    itemsCount,
    items,
    targetFiltered,
  };
}

export type SerpClassification =
  /** A SERP was returned and can be read. */
  | { kind: 'SERP'; view: SerpPayloadView }
  /** No SERP was returned. Retryable; never a ranking. */
  | { kind: 'EMPTY'; view: SerpPayloadView };

/**
 * Decide whether a response contains a SERP at all.
 *
 * Empty means any of: the task reported an empty-SERP status (40102), `items`
 * was null, or `items` was an empty array. None of those tell us anything
 * about the tracked domain.
 *
 * The one exception is a response whose request carried a `target` filter. The
 * provider then only returns results for that target, so "no items" is the
 * answer to "does this domain appear?" and is a genuine NOT_RANKED.
 */
export function classifySerpPayload(payload: unknown): SerpClassification {
  const view = readSerpPayload(payload);
  const hasItems = Array.isArray(view.items) && view.items.length > 0;

  if (hasItems) return { kind: 'SERP', view };

  if (view.targetFiltered) {
    // Target-filtered and nothing matched: the SERP was read, the domain is
    // not in it. `items` stays empty and the caller reports NOT_RANKED.
    return { kind: 'SERP', view: { ...view, items: [] } };
  }

  return { kind: 'EMPTY', view };
}

/**
 * Extract organic results from a DataForSEO live/advanced response.
 *
 * Positions are computed from the organic items only, in SERP order. Every
 * other top-level element is dropped before numbering — ads and shopping
 * units, but equally the AI Overview, People Also Ask, Related Searches,
 * featured snippets, local packs and video carousels — so the first organic
 * result is always #1 and a SERP feature never consumes a position.
 *
 * Only top-level items are considered. Nested URLs (an AI Overview's
 * references, a PAA answer's source, an organic result's `related_result`
 * siblings under `group_organic_results`) are not separate rankings and are
 * deliberately not walked into.
 */
export function extractOrganicResults(payload: unknown): OrganicResult[] {
  const view = readSerpPayload(payload);
  return organicFromItems(view.items);
}

function organicFromItems(items: unknown[] | null): OrganicResult[] {
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

/** The item types this parser deliberately does not count. Exported for tests. */
export const IGNORED_ITEM_TYPES: readonly string[] = NON_ORGANIC_ITEM_TYPES;

/**
 * Find a domain's best position among organic results.
 *
 * Matching is on the parsed hostname, so http vs https, a trailing slash, a
 * port and a query string make no difference, and `www.wroffy.com` and
 * `wroffy.com` are the same site. Subdomains count as the domain, which is the
 * rule the rest of the app already uses (see `hostMatchesDomain`).
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

/**
 * Build the live/advanced request body for one keyword.
 *
 * `location_code` is whatever the keyword resolved to — the country when no
 * city was chosen, the city otherwise — so a country-level and a city-level
 * check are two different requests, never the same one relabelled.
 *
 * `device` is passed straight through. A mobile position always comes from a
 * mobile request; a desktop result is never reused for one.
 *
 * Deliberately absent: `target`. It makes the provider return only the results
 * matching that domain, which turns "not in the top N" into an empty task and
 * throws away the surrounding SERP we need to compute a position from.
 */
export function buildSerpTask(lookup: RankingLookup) {
  const language = getLanguage(lookup.language);

  return {
    keyword: lookup.keyword,
    location_code: lookup.locationCode,
    language_code: language.languageCode,
    device: toDataForSeoDevice(lookup.device),
    os: lookup.device === 'MOBILE' ? 'android' : 'windows',
    // The provider reads depth in whole pages of 10 and rejects anything
    // outside 10..700.
    depth: normalizeDepth(lookup.results),
    se_domain: lookup.googleDomain,
  };
}

/** One request. Throws DataForSeoError; otherwise returns what came back. */
async function fetchSerpOnce(
  lookup: RankingLookup,
  requestId: string,
): Promise<SerpClassification> {
  const task = buildSerpTask(lookup);
  const payload = await callDataForSeo<unknown>(
    LIVE_ADVANCED_PATH,
    [task],
    requestId,
    EMPTY_SERP_STATUS_CODES,
  );
  return classifySerpPayload(payload);
}

/** How long to wait before retry number `retry` (1-based). */
export function emptySerpBackoffMs(retry: number): number {
  const index = Math.min(Math.max(retry, 1), EMPTY_SERP_BACKOFF_MS.length) - 1;
  return EMPTY_SERP_BACKOFF_MS[index];
}

/**
 * Fetch a SERP from DataForSEO, retrying an empty one.
 *
 * An empty SERP (40102 / `items: null`) is usually transient, so it is asked
 * for again after 2s, then 5s, then 10s. When every attempt comes back empty
 * the outcome is SERP_UNAVAILABLE — an admission that we do not know, never a
 * position of zero and never "not ranking".
 *
 * No caching — see `serp-cache.ts` for the cached path.
 */
export async function fetchSerp(
  lookup: RankingLookup,
  requestId: string,
): Promise<SerpFetchOutcome> {
  const retries = Math.max(0, Math.min(env.SERP_EMPTY_RETRIES, 5));
  const totalAttempts = retries + 1;

  let last: SerpPayloadView | null = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    logger.info('serp request started', {
      requestId,
      keyword: lookup.keyword,
      locationCode: lookup.locationCode,
      device: lookup.device,
      depth: normalizeDepth(lookup.results),
      attempt,
      totalAttempts,
    });

    const outcome = await fetchSerpOnce(lookup, requestId);
    last = outcome.view;

    if (outcome.kind === 'SERP') {
      const organic = organicFromItems(outcome.view.items);
      logger.info('serp request succeeded', {
        requestId,
        keyword: lookup.keyword,
        status: outcome.view.apiStatusCode,
        itemsCount: outcome.view.items?.length ?? 0,
        organicCount: organic.length,
        attempt,
      });
      return {
        status: 'OK',
        organic,
        apiStatusCode: outcome.view.apiStatusCode,
        apiStatusMessage: outcome.view.apiStatusMessage || null,
        attempts: attempt,
      };
    }

    const emptyContext = {
      requestId,
      keyword: lookup.keyword,
      locationCode: lookup.locationCode,
      device: lookup.device,
      status: outcome.view.apiStatusCode,
      itemsCount: outcome.view.itemsCount,
      attempt,
      totalAttempts,
    };

    if (EMPTY_SERP_STATUS_CODES.has(outcome.view.apiStatusCode)) {
      logger.warn(`serp returned ${outcome.view.apiStatusCode}`, emptyContext);
    } else {
      logger.warn('serp returned no items', emptyContext);
    }

    if (attempt <= retries) {
      const waitMs = emptySerpBackoffMs(attempt);
      logger.warn(`serp retry ${attempt}/${retries}`, { ...emptyContext, waitMs });
      await sleep(waitMs);
    }
  }

  logger.error('serp unavailable', {
    requestId,
    keyword: lookup.keyword,
    locationCode: lookup.locationCode,
    device: lookup.device,
    status: last?.apiStatusCode ?? null,
    attempts: totalAttempts,
  });

  return {
    status: 'SERP_UNAVAILABLE',
    organic: [],
    apiStatusCode: last?.apiStatusCode ?? null,
    apiStatusMessage: last?.apiStatusMessage || null,
    attempts: totalAttempts,
  };
}

/**
 * Turn a fetch outcome into the row we store.
 *
 * Pure, so the four statuses can be asserted without a network stub.
 */
export function resolveRanking(
  outcome: SerpFetchOutcome,
  domain: string,
  requestId = 'no-request-id',
): RankingResult {
  if (outcome.status === 'SERP_UNAVAILABLE') {
    // No SERP was read. There is nothing to say about this domain, so we say
    // nothing: a null position, not a zero and not "not ranking".
    return {
      status: 'SERP_UNAVAILABLE',
      position: null,
      rankingUrl: null,
      resultsChecked: null,
      apiStatusCode: outcome.apiStatusCode,
      apiStatusMessage: outcome.apiStatusMessage,
      attempts: outcome.attempts,
    };
  }

  const { position, rankingUrl } = findDomainPosition(outcome.organic, domain);

  if (position !== null) {
    logger.info('domain found at position', {
      requestId,
      position,
      resultsChecked: outcome.organic.length,
    });
  } else {
    logger.info('domain not found', {
      requestId,
      resultsChecked: outcome.organic.length,
    });
  }

  return {
    status: position === null ? 'NOT_RANKED' : 'RANKED',
    position,
    rankingUrl,
    resultsChecked: outcome.organic.length,
    apiStatusCode: outcome.apiStatusCode,
    apiStatusMessage: outcome.apiStatusMessage,
    attempts: outcome.attempts,
  };
}

/** The row to store when the call itself failed (auth, billing, network). */
export function apiErrorResult(error: unknown): RankingResult {
  const dfs = error instanceof DataForSeoError ? error : null;
  return {
    status: 'API_ERROR',
    position: null,
    rankingUrl: null,
    resultsChecked: null,
    apiStatusCode: dfs?.statusCode ?? null,
    apiStatusMessage:
      dfs?.apiStatusMessage ?? (dfs ? dfs.userMessage : 'The ranking check could not be run.'),
    attempts: MAX_ATTEMPTS,
  };
}

/**
 * The one function the rest of the app calls to rank a keyword.
 * Returns only what we store — never the raw provider response.
 */
export async function checkKeywordRanking(
  lookup: RankingLookup,
  outcomeOverride?: SerpFetchOutcome,
  requestId = 'no-request-id',
): Promise<RankingResult> {
  const outcome = outcomeOverride ?? (await fetchSerp(lookup, requestId));
  return resolveRanking(outcome, lookup.domain, requestId);
}

export type ProviderLocation = {
  location_code: number;
  location_name: string;
  country_iso_code?: string;
  location_type?: string;
};

/**
 * The locations DataForSEO supports.
 *
 * With a country ISO code this asks for that country's subtree, which is the
 * difference between a few thousand rows and every location on earth. The
 * endpoint is a reference list and costs nothing to call.
 */
export async function fetchLocationList(
  countryIso?: string,
  requestId = 'locations',
): Promise<ProviderLocation[]> {
  const path = countryIso ? `${LOCATIONS_PATH}/${encodeURIComponent(countryIso)}` : LOCATIONS_PATH;

  const payload = await callDataForSeo<{ tasks?: { result?: unknown[] }[] }>(
    path,
    null,
    requestId,
  );

  const result = payload?.tasks?.[0]?.result;
  if (!Array.isArray(result)) return [];
  return result as ProviderLocation[];
}

/** Country locations reported by DataForSEO, used by the verification script. */
export async function fetchCountryLocations(
  requestId = 'locations',
): Promise<ProviderLocation[]> {
  return fetchLocationList(undefined, requestId);
}
