import 'server-only';

import { createHash } from 'node:crypto';

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { fetchSerp, type OrganicResult, type RankingLookup } from '@/lib/dataforseo';

/**
 * Short-lived cache in front of DataForSEO.
 *
 * This is a cache, not a provider abstraction: there is exactly one provider
 * and `fetchSerp` is called directly on a miss.
 */

export function buildCacheKey(lookup: RankingLookup): string {
  const parts = [
    lookup.keyword.trim().toLowerCase(),
    lookup.country,
    lookup.language,
    lookup.device,
    String(lookup.results),
  ].join('|');
  return createHash('sha256').update(parts).digest('hex');
}

export async function fetchSerpCached(
  lookup: RankingLookup,
  requestId: string,
): Promise<{ organic: OrganicResult[]; cached: boolean }> {
  const ttlMinutes = env.SERP_CACHE_MINUTES;

  if (ttlMinutes <= 0) {
    return { organic: await fetchSerp(lookup, requestId), cached: false };
  }

  const cacheKey = buildCacheKey(lookup);

  try {
    const hit = await prisma.serpCache.findUnique({ where: { cacheKey } });
    if (hit && hit.expiresAt > new Date()) {
      logger.debug('serp cache hit', { requestId, cacheKey });
      return { organic: hit.payload as unknown as OrganicResult[], cached: true };
    }
  } catch (error) {
    // A cache read failure must never fail a ranking check.
    logger.warn('serp cache read failed', { requestId, error });
  }

  const organic = await fetchSerp(lookup, requestId);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  try {
    await prisma.serpCache.upsert({
      where: { cacheKey },
      create: { cacheKey, payload: organic as unknown as object, expiresAt },
      update: { payload: organic as unknown as object, expiresAt },
    });
  } catch (error) {
    logger.warn('serp cache write failed', { requestId, error });
  }

  return { organic, cached: false };
}

/** Drop expired rows. Called opportunistically at the start of a rank check. */
export async function pruneSerpCache(): Promise<void> {
  try {
    await prisma.serpCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (error) {
    logger.warn('serp cache prune failed', { error });
  }
}
