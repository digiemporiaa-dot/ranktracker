import { describe, expect, it } from 'vitest';

import { buildCacheKey } from '@/lib/serp-cache';
import type { RankingLookup } from '@/lib/dataforseo';

/**
 * The cache key decides which stored SERP a lookup is allowed to reuse.
 * Anything that can change the result set has to be part of it.
 */
const base: RankingLookup = {
  keyword: 'buy business software',
  domain: 'wroffy.com',
  country: 'IN',
  language: 'en',
  device: 'DESKTOP',
  results: 100,
};

describe('buildCacheKey', () => {
  it('separates google.com from google.co.in', () => {
    // Without this, a google.com SERP would be served for a google.co.in
    // check for as long as the cache entry lived.
    const com = buildCacheKey({ ...base, searchDomain: 'google.com' });
    const co_in = buildCacheKey({ ...base, searchDomain: 'google.co.in' });

    expect(com).not.toBe(co_in);
  });

  it('treats an absent search domain as google.com', () => {
    // Rows cached before the setting existed must stay reachable.
    expect(buildCacheKey(base)).toBe(buildCacheKey({ ...base, searchDomain: 'google.com' }));
  });

  it('still separates keyword, country, device and depth', () => {
    const keys = new Set([
      buildCacheKey(base),
      buildCacheKey({ ...base, keyword: 'something else' }),
      buildCacheKey({ ...base, country: 'US' }),
      buildCacheKey({ ...base, device: 'MOBILE' }),
      buildCacheKey({ ...base, results: 50 }),
    ]);

    expect(keys.size).toBe(5);
  });

  it('ignores the tracked domain, which does not change the SERP', () => {
    // The SERP is the same page whoever is looking for themselves in it.
    expect(buildCacheKey(base)).toBe(buildCacheKey({ ...base, domain: 'example.com' }));
  });
});
