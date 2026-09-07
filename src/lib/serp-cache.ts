import 'server-only';

import { createHash } from 'node:crypto';

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { fetchSerp, type OrganicResult, type RankingLookup, type SerpFetchOutcome } from '@/lib/dataforseo';

/**
 * Short-lived cache in front of DataForSEO.
 *
 * This is a cache, not a provider abstraction: there is exactly one provider
 * and `fetchSerp` is called directly on a miss.
 */

/**
 * The identity of a SERP response.
 *
 * The location code and the Google domain are part of the key, so a
 * country-level result is never served to a city-level check, and a desktop
 * response is never handed to a mobile one.
 */
export function buildCacheKey(lookup: RankingLookup): string {
  const parts = [
    lookup.keyword.trim().toLowerCase(),
    String(lookup.locationCode),
    lookup.googleDomain,
    lookup.language,
    lookup.device,
    String(lookup.results),
  ].join('|');
  return `serp:${createHash('sha256').update(parts).digest('hex')}`;
}

/**
 * A SERP for this lookup, from the cache when there is a fresh one.
 *
 * Only a SERP that was actually read is cached. An unavailable response is
 * never stored: caching it would turn one 40102 into half an hour of them, and
 * every keyword sharing the cache key would inherit a failure that has nothing
 * to do with it. A cache hit is always an OK outcome by construction.
 */
export async function fetchSerpCached(
  lookup: RankingLookup,
  requestId: string,
): Promise<{ outcome: SerpFetchOutcome; cached: boolean }> {
  const ttlMinutes = env.SERP_CACHE_MINUTES;

  if (ttlMinutes <= 0) {
    return { outcome: await fetchSerp(lookup, requestId), cached: false };
  }

  const cacheKey = buildCacheKey(lookup);

  try {
    const hit = await prisma.serpCache.findUnique({ where: { cacheKey } });
    if (hit && hit.expiresAt > new Date()) {
      logger.debug('serp cache hit', { requestId, cacheKey });
      const organic = hit.payload as unknown as OrganicResult[];
      return {
        outcome: {
          status: 'OK',
          organic: Array.isArray(organic) ? organic : [],
          apiStatusCode: null,
          apiStatusMessage: null,
          attempts: 0,
        },
        cached: true,
      };
    }
  } catch (error) {
    // A cache read failure must never fail a ranking check.
    logger.warn('serp cache read failed', { requestId, error });
  }

  const outcome = await fetchSerp(lookup, requestId);

  if (outcome.status !== 'OK') return { outcome, cached: false };

  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  try {
    await prisma.serpCache.upsert({
      where: { cacheKey },
      create: { cacheKey, payload: outcome.organic as unknown as object, expiresAt },
      update: { payload: outcome.organic as unknown as object, expiresAt },
    });
  } catch (error) {
    logger.warn('serp cache write failed', { requestId, error });
  }

  return { outcome, cached: false };
}

/** Drop expired rows. Called opportunistically at the start of a rank check. */
export async function pruneSerpCache(): Promise<void> {
  try {
    await prisma.serpCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    logger.warn('serp cache prune failed', { error });
  }
}
