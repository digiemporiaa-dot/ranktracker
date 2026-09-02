import { describe, expect, it } from 'vitest';

import {
  buildSerpTask,
  extractOrganicResults,
  findDomainPosition,
} from '@/lib/dataforseo';

/** Build a DataForSEO-shaped response from a list of SERP elements. */
function serpResponse(items: { type: string; url?: string; domain?: string }[]) {
  return {
    status_code: 20000,
    tasks: [
      {
        result: [
          {
            items: items.map((item, index) => ({
              type: item.type,
              rank_absolute: index + 1,
              rank_group: index + 1,
              url: item.url ?? `https://example-${index}.com/`,
              domain: item.domain ?? `example-${index}.com`,
              title: `Result ${index + 1}`,
            })),
          },
        ],
      },
    ],
  };
}

const organicUrl = (n: number) => `https://site-${n}.com/page`;

describe('extractOrganicResults', () => {
  it('numbers organic results from 1, ignoring paid results that precede them', () => {
    const payload = serpResponse([
      { type: 'paid', url: 'https://ad-one.com/' },
      { type: 'paid', url: 'https://ad-two.com/' },
      { type: 'organic', url: organicUrl(1) },
      { type: 'organic', url: organicUrl(2) },
      { type: 'organic', url: organicUrl(3) },
    ]);

    const organic = extractOrganicResults(payload);

    expect(organic).toHaveLength(3);
    expect(organic.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(organic[0].url).toBe(organicUrl(1));
  });

  it('drops every non-organic SERP element', () => {
    const payload = serpResponse([
      { type: 'paid' },
      { type: 'shopping' },
      { type: 'featured_snippet' },
      { type: 'people_also_ask' },
      { type: 'local_pack' },
      { type: 'video' },
      { type: 'organic', url: organicUrl(1) },
      { type: 'top_stories' },
      { type: 'organic', url: organicUrl(2) },
    ]);

    const organic = extractOrganicResults(payload);
    expect(organic.map((r) => r.url)).toEqual([organicUrl(1), organicUrl(2)]);
    expect(organic.map((r) => r.position)).toEqual([1, 2]);
  });

  it('orders results by rank_absolute even when items arrive out of order', () => {
    const payload = {
      status_code: 20000,
      tasks: [
        {
          result: [
            {
              items: [
                { type: 'organic', rank_absolute: 5, url: organicUrl(2), domain: 'site-2.com' },
                { type: 'paid', rank_absolute: 1, url: 'https://ad.com/', domain: 'ad.com' },
                { type: 'organic', rank_absolute: 3, url: organicUrl(1), domain: 'site-1.com' },
              ],
            },
          ],
        },
      ],
    };

    const organic = extractOrganicResults(payload);
    expect(organic.map((r) => r.url)).toEqual([organicUrl(1), organicUrl(2)]);
    expect(organic.map((r) => r.position)).toEqual([1, 2]);
  });

  it('returns an empty list for empty or malformed payloads', () => {
    expect(extractOrganicResults(null)).toEqual([]);
    expect(extractOrganicResults({})).toEqual([]);
    expect(extractOrganicResults({ tasks: [] })).toEqual([]);
    expect(extractOrganicResults({ tasks: [{ result: null }] })).toEqual([]);
    expect(extractOrganicResults({ tasks: [{ result: [{ items: null }] }] })).toEqual([]);
    expect(extractOrganicResults(serpResponse([]))).toEqual([]);
  });

  it('skips organic items that have no URL', () => {
    const payload = {
      status_code: 20000,
      tasks: [
        {
          result: [
            {
              items: [
                { type: 'organic', rank_absolute: 1, url: null },
                { type: 'organic', rank_absolute: 2, url: organicUrl(1) },
              ],
            },
          ],
        },
      ],
    };
    const organic = extractOrganicResults(payload);
    expect(organic).toHaveLength(1);
    expect(organic[0].position).toBe(1);
  });
});

describe('findDomainPosition', () => {
  const build = (urls: string[]) =>
    extractOrganicResults(serpResponse(urls.map((url) => ({ type: 'organic', url }))));

  it('finds position #1', () => {
    const organic = build(['https://wroffy.com/a', organicUrl(2)]);
    expect(findDomainPosition(organic, 'wroffy.com')).toEqual({
      position: 1,
      rankingUrl: 'https://wroffy.com/a',
    });
  });

  it('finds position #10', () => {
    const urls = Array.from({ length: 20 }, (_, i) =>
      i === 9 ? 'https://www.wroffy.com/ten' : organicUrl(i),
    );
    const result = findDomainPosition(build(urls), 'wroffy.com');
    expect(result.position).toBe(10);
    expect(result.rankingUrl).toBe('https://www.wroffy.com/ten');
  });

  it('finds position #50', () => {
    const urls = Array.from({ length: 100 }, (_, i) =>
      i === 49 ? 'https://blog.wroffy.com/fifty' : organicUrl(i),
    );
    expect(findDomainPosition(build(urls), 'wroffy.com').position).toBe(50);
  });

  it('finds position #100', () => {
    const urls = Array.from({ length: 100 }, (_, i) =>
      i === 99 ? 'https://wroffy.com/hundred' : organicUrl(i),
    );
    expect(findDomainPosition(build(urls), 'wroffy.com').position).toBe(100);
  });

  it('returns null when the domain is not present', () => {
    const organic = build([organicUrl(1), organicUrl(2), organicUrl(3)]);
    expect(findDomainPosition(organic, 'wroffy.com')).toEqual({
      position: null,
      rankingUrl: null,
    });
  });

  it('keeps the best position when the domain appears more than once', () => {
    const urls = Array.from({ length: 20 }, (_, i) => {
      if (i === 3) return 'https://wroffy.com/page-a';
      if (i === 17) return 'https://wroffy.com/page-b';
      return organicUrl(i);
    });

    expect(findDomainPosition(build(urls), 'wroffy.com')).toEqual({
      position: 4,
      rankingUrl: 'https://wroffy.com/page-a',
    });
  });

  it('counts organic position correctly when ads come first', () => {
    const payload = serpResponse([
      { type: 'paid', url: 'https://ad.com/' },
      { type: 'paid', url: 'https://ad2.com/' },
      { type: 'organic', url: organicUrl(1) },
      { type: 'organic', url: organicUrl(2) },
      { type: 'organic', url: 'https://wroffy.com/page' },
    ]);

    // Absolute SERP position would be 5; organic position is 3.
    expect(findDomainPosition(extractOrganicResults(payload), 'wroffy.com').position).toBe(3);
  });

  it('does not match lookalike domains', () => {
    const organic = build([
      'https://fakewroffy.com/a',
      'https://wroffy.com.evil.com/b',
      'https://example.com/wroffy.com',
    ]);
    expect(findDomainPosition(organic, 'wroffy.com').position).toBeNull();
  });

  it('returns null for an unusable target domain', () => {
    const organic = build(['https://wroffy.com/a']);
    expect(findDomainPosition(organic, '').position).toBeNull();
  });
});

describe('buildSerpTask', () => {
  it('maps country, language and device to DataForSEO fields', () => {
    const task = buildSerpTask({
      keyword: 'microsoft reseller india',
      domain: 'wroffy.com',
      country: 'IN',
      language: 'en',
      device: 'DESKTOP',
      results: 100,
    });

    expect(task).toMatchObject({
      keyword: 'microsoft reseller india',
      location_code: 2356,
      language_code: 'en',
      device: 'desktop',
      depth: 100,
      se_domain: 'google.com',
    });
  });

  it('maps mobile to a mobile OS', () => {
    const task = buildSerpTask({
      keyword: 'k',
      domain: 'wroffy.com',
      country: 'US',
      language: 'en',
      device: 'MOBILE',
      results: 50,
    });
    expect(task.device).toBe('mobile');
    expect(task.os).toBe('android');
    expect(task.location_code).toBe(2840);
  });

  it('never includes credentials in the task payload', () => {
    const task = buildSerpTask({
      keyword: 'k',
      domain: 'wroffy.com',
      country: 'GB',
      language: 'en',
      device: 'DESKTOP',
      results: 10,
    });
    const keys = Object.keys(task).join(',').toLowerCase();
    expect(keys).not.toContain('login');
    expect(keys).not.toContain('password');
  });
});
