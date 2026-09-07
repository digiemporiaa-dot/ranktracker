import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The four outcomes of a ranking check, and the one distinction the whole
 * feature exists for: "we could not read the SERP" is not "the site does not
 * rank". `fetch` is stubbed — no network is touched.
 *
 * The 40102 payloads below are the real thing: a v3 envelope that reports
 * 20000 ("your request ran") wrapping a task that reports 40102 ("...and
 * produced no SERP"), with `items: null` and `items_count: 0`.
 */

async function loadClient(env: Record<string, string> = {}) {
  vi.resetModules();
  process.env.DATAFORSEO_LOGIN = env.DATAFORSEO_LOGIN ?? 'test-login';
  process.env.DATAFORSEO_PASSWORD = env.DATAFORSEO_PASSWORD ?? 'test-password';
  process.env.SERP_EMPTY_RETRIES = env.SERP_EMPTY_RETRIES ?? '3';
  return import('@/lib/dataforseo');
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const LOOKUP = {
  keyword: 'microsoft reseller in india',
  domain: 'wroffy.com',
  country: 'IN' as const,
  city: null,
  locationCode: 2356,
  googleDomain: 'google.co.in',
  language: 'en' as const,
  device: 'DESKTOP' as const,
  results: 50,
};

/** A task `data` block, as DataForSEO echoes the request back. */
function requestEcho(extra: Record<string, unknown> = {}) {
  return {
    api: 'serp',
    function: 'live',
    se: 'google',
    se_type: 'organic',
    keyword: 'microsoft reseller in india',
    location_code: 2356,
    language_code: 'en',
    device: 'desktop',
    os: 'windows',
    depth: 50,
    group_organic_results: true,
    people_also_ask_click_depth: 1,
    ...extra,
  };
}

/** The exact shape reported in the bug: 40102, items_count 0, items null. */
function emptySerpPayload(overrides: { target?: string; items?: unknown; itemsCount?: number } = {}) {
  return {
    version: '0.1.20260101',
    status_code: 20000,
    status_message: 'Ok.',
    cost: 0.01015,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: 'task-id',
        status_code: 40102,
        status_message: 'No Search Results.',
        cost: 0.01015,
        result_count: 1,
        path: ['v3', 'serp', 'google', 'organic', 'live', 'advanced'],
        data: requestEcho(overrides.target ? { target: overrides.target } : {}),
        result: [
          {
            keyword: 'microsoft reseller in india',
            type: 'organic',
            se_domain: 'google.com',
            se_results_count: 165,
            pages_count: 5,
            items_count: overrides.itemsCount ?? 0,
            items: overrides.items === undefined ? null : overrides.items,
          },
        ],
      },
    ],
  };
}

/** A normal SERP. `items` is passed through verbatim. */
function serpPayload(items: unknown[]) {
  return {
    version: '0.1.20260101',
    status_code: 20000,
    status_message: 'Ok.',
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: 'task-id',
        status_code: 20000,
        status_message: 'Ok.',
        result_count: 1,
        data: requestEcho(),
        result: [
          {
            keyword: 'microsoft reseller in india',
            type: 'organic',
            se_results_count: 165,
            items_count: items.length,
            items,
          },
        ],
      },
    ],
  };
}

/** N organic results, with `hit` (1-based) pointing at the tracked domain. */
function organicItems(count: number, hit: number | null, hitUrl = 'https://wroffy.com/microsoft') {
  return Array.from({ length: count }, (_, index) => {
    const url = index + 1 === hit ? hitUrl : `https://competitor-${index + 1}.example.com/page`;
    return {
      type: 'organic',
      rank_group: index + 1,
      rank_absolute: index + 1,
      url,
      domain: new URL(url).hostname,
      title: `Result ${index + 1}`,
    };
  });
}

describe('SERP outcome classification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.SERP_EMPTY_RETRIES;
  });

  /* ----------------------------------------------------------------- A-C */

  it('A: reports RANKED at #1 when the domain is the first organic result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(serpPayload(organicItems(50, 1)))));

    const { checkKeywordRanking } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-a');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe('RANKED');
    expect(result.position).toBe(1);
    expect(result.rankingUrl).toBe('https://wroffy.com/microsoft');
    expect(result.resultsChecked).toBe(50);
  });

  it('B: reports RANKED at #10 when the domain is the tenth organic result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(serpPayload(organicItems(50, 10)))));

    const { checkKeywordRanking } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-b');
    await vi.runAllTimersAsync();

    expect((await promise).position).toBe(10);
  });

  it('C: reports NOT_RANKED with a null position when the domain is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(serpPayload(organicItems(50, null)))),
    );

    const { checkKeywordRanking } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-c');
    await vi.runAllTimersAsync();
    const result = await promise;

    // A SERP was read and the domain was not in it. That is a measurement.
    expect(result.status).toBe('NOT_RANKED');
    expect(result.position).toBeNull();
    expect(result.resultsChecked).toBe(50);
  });

  /* ----------------------------------------------------------------- D-G */

  it('D: retries a 40102 and succeeds on the second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(emptySerpPayload()))
      .mockResolvedValue(jsonResponse(serpPayload(organicItems(50, 7))));
    vi.stubGlobal('fetch', fetchMock);

    const { checkKeywordRanking } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-d');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('RANKED');
    expect(result.position).toBe(7);
    expect(result.attempts).toBe(2);
  });

  it('E: gives up as SERP_UNAVAILABLE when every attempt returns 40102', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emptySerpPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const { checkKeywordRanking } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-e');
    await vi.runAllTimersAsync();
    const result = await promise;

    // One first attempt plus three retries, then it stops. Never forever.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.status).toBe('SERP_UNAVAILABLE');
    expect(result.position).toBeNull();
    expect(result.attempts).toBe(4);
    expect(result.apiStatusCode).toBe(40102);
    expect(result.apiStatusMessage).toBe('No Search Results.');
    // No SERP was read, so we do not claim to have inspected zero results.
    expect(result.resultsChecked).toBeNull();
  });

  it('F: treats items: null as no SERP, not as an empty SERP', async () => {
    const { classifySerpPayload } = await loadClient();
    const classification = classifySerpPayload(emptySerpPayload({ items: null }));

    expect(classification.kind).toBe('EMPTY');
    expect(classification.view.items).toBeNull();
  });

  it('G: treats items_count 0 with an empty items array as no SERP', async () => {
    const { classifySerpPayload } = await loadClient();

    expect(classifySerpPayload(emptySerpPayload({ items: [], itemsCount: 0 })).kind).toBe('EMPTY');
  });

  it('reads the task status even when the envelope says 20000', async () => {
    const { readSerpPayload } = await loadClient();
    const view = readSerpPayload(emptySerpPayload());

    // The envelope reports success; only the task knows there is no SERP.
    expect(view.apiStatusCode).toBe(40102);
    expect(view.apiStatusMessage).toBe('No Search Results.');
    expect(view.itemsCount).toBe(0);
  });

  it('reads a 40102 produced by a target filter as NOT_RANKED, not unavailable', async () => {
    // `target` makes DataForSEO return only the results matching that domain,
    // so an empty task answers the ranking question instead of dodging it.
    // This app never sends `target`; a payload that carries one is still read
    // correctly.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(emptySerpPayload({ target: 'wroffy.com' })));
    vi.stubGlobal('fetch', fetchMock);

    const { checkKeywordRanking } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-target');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe('NOT_RANKED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /* ----------------------------------------------------------------- H-I */

  it('H: numbers organic results from #1 with an AI Overview above them', async () => {
    const items = [
      {
        type: 'ai_overview',
        rank_absolute: 1,
        // The AI Overview cites the tracked domain. That is not a ranking.
        references: [{ type: 'ai_overview_reference', url: 'https://wroffy.com/ai', domain: 'wroffy.com' }],
      },
      ...organicItems(3, 2).map((item, index) => ({ ...item, rank_absolute: index + 2 })),
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(serpPayload(items))));

    const { checkKeywordRanking, extractOrganicResults } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-h');
    await vi.runAllTimersAsync();
    const result = await promise;

    const organic = extractOrganicResults(serpPayload(items));
    expect(organic).toHaveLength(3);
    expect(organic[0].position).toBe(1);
    // The domain sits at organic #2 even though the AI Overview took slot 1,
    // and the AI Overview's own reference to it is not counted.
    expect(result.position).toBe(2);
    expect(result.status).toBe('RANKED');
  });

  it('I: ignores People Also Ask, Related Searches and ads when numbering', async () => {
    const items = [
      { type: 'paid', rank_absolute: 1, url: 'https://ads.example.com/a', domain: 'ads.example.com' },
      { type: 'paid', rank_absolute: 2, url: 'https://ads.example.com/b', domain: 'ads.example.com' },
      {
        type: 'people_also_ask',
        rank_absolute: 3,
        items: [
          {
            type: 'people_also_ask_element',
            expanded_element: [{ type: 'people_also_ask_expanded_element', url: 'https://wroffy.com/paa' }],
          },
        ],
      },
      { type: 'organic', rank_group: 1, rank_absolute: 4, url: 'https://a.example.com/', domain: 'a.example.com' },
      { type: 'related_searches', rank_absolute: 5, items: ['microsoft reseller delhi'] },
      { type: 'organic', rank_group: 2, rank_absolute: 6, url: 'https://wroffy.com/', domain: 'wroffy.com' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(serpPayload(items))));

    const { checkKeywordRanking } = await loadClient();
    const promise = checkKeywordRanking(LOOKUP, undefined, 'req-i');
    await vi.runAllTimersAsync();
    const result = await promise;

    // Two ads and a PAA block above it, and the domain's PAA appearance
    // earlier in the page: the organic position is still #2.
    expect(result.position).toBe(2);
    expect(result.resultsChecked).toBe(2);
  });

  /* ------------------------------------------------------------------- J */

  it('J: matches www, http, ports, trailing slashes and subdomains', async () => {
    const { findDomainPosition } = await loadClient();

    const cases: [string, number | null][] = [
      ['https://www.wroffy.com/microsoft', 1],
      ['http://wroffy.com', 1],
      ['https://wroffy.com/', 1],
      ['https://WROFFY.com/Microsoft/?utm=1', 1],
      ['https://blog.wroffy.com/post', 1],
      ['https://www.wroffy.com:8443/x', 1],
      // Lookalikes are not the domain.
      ['https://fakewroffy.com/', null],
      ['https://wroffy.com.evil.com/', null],
      ['https://example.com/wroffy.com', null],
    ];

    for (const [url, expected] of cases) {
      const organic = [{ position: 1, url, domain: new URL(url).hostname, title: null }];
      expect(findDomainPosition(organic, 'wroffy.com').position, url).toBe(expected);
    }

    // The tracked domain written with www resolves to the same site.
    const organic = [
      { position: 1, url: 'https://www.wroffy.com/x', domain: 'www.wroffy.com', title: null },
    ];
    expect(findDomainPosition(organic, 'https://www.wroffy.com/').position).toBe(1);
  });

  /* ------------------------------------------------------------------- K */

  it('K: never turns an unavailable SERP into rank 0 or NOT_RANKED', async () => {
    const { resolveRanking } = await loadClient();

    const result = resolveRanking(
      {
        status: 'SERP_UNAVAILABLE',
        organic: [],
        apiStatusCode: 40102,
        apiStatusMessage: 'No Search Results.',
        attempts: 4,
      },
      'wroffy.com',
      'req-k',
    );

    expect(result.status).toBe('SERP_UNAVAILABLE');
    expect(result.position).toBeNull();
    expect(result.position).not.toBe(0);
    // And it is not quietly relabelled as a measurement.
    expect(result.status).not.toBe('NOT_RANKED');
  });

  it('reports API_ERROR, with a null position, when the call never completed', async () => {
    const { apiErrorResult, DataForSeoError } = await loadClient();

    const result = apiErrorResult(
      new DataForSeoError({ message: 'HTTP 401', retryable: false, statusCode: 401 }),
    );

    expect(result.status).toBe('API_ERROR');
    expect(result.position).toBeNull();
    expect(result.apiStatusCode).toBe(401);
  });

  /* --------------------------------------------------------------- retry */

  it('waits 2s, then 5s, then 10s between empty-SERP attempts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emptySerpPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp(LOOKUP, 'req-backoff');

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.runAllTimersAsync();
    // It stops there rather than retrying forever.
    expect((await promise).status).toBe('SERP_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('honours SERP_EMPTY_RETRIES=0 by not retrying at all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(emptySerpPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient({ SERP_EMPTY_RETRIES: '0' });
    const promise = fetchSerp(LOOKUP, 'req-no-retry');
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await promise).status).toBe('SERP_UNAVAILABLE');
  });

  /* -------------------------------------------------------------- request */

  it('sends a depth DataForSEO accepts and no target filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(serpPayload(organicItems(10, 1))));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp({ ...LOOKUP, results: 55 }, 'req-depth');
    await vi.runAllTimersAsync();
    await promise;

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)[0];
    // 55 is not a whole page; the provider would round it up anyway.
    expect(body.depth).toBe(60);
    // `target` would filter the SERP down to one domain and destroy the
    // surrounding results a position is computed from.
    expect(body).not.toHaveProperty('target');
  });

  it.each([10, 20, 50])('keeps a valid depth of %i unchanged', async (depth) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(serpPayload(organicItems(10, 1))));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp({ ...LOOKUP, results: depth }, `req-depth-${depth}`);
    await vi.runAllTimersAsync();
    await promise;

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0].depth).toBe(depth);
  });

  /* -------------------------------------------------------------- logging */

  it('logs the 40102, each retry and the giving-up, and never a credential', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(emptySerpPayload())));

    const { fetchSerp } = await loadClient({
      DATAFORSEO_LOGIN: 'secret-login',
      DATAFORSEO_PASSWORD: 'secret-password',
    });
    const promise = fetchSerp(LOOKUP, 'req-log');
    await vi.runAllTimersAsync();
    await promise;

    const lines = [...warn.mock.calls, ...error.mock.calls, ...info.mock.calls]
      .map((call) => String(call[0]))
      .join('\n');

    expect(lines).toContain('serp request started');
    expect(lines).toContain('serp returned 40102');
    expect(lines).toContain('serp retry 1/3');
    expect(lines).toContain('serp retry 2/3');
    expect(lines).toContain('serp retry 3/3');
    expect(lines).toContain('serp unavailable');

    expect(lines).not.toContain('secret-login');
    expect(lines).not.toContain('secret-password');
    expect(lines).not.toMatch(/Basic [A-Za-z0-9+/=]{8,}/);
  });

  it('logs where the domain was found, and that it was not', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(serpPayload(organicItems(20, 4)))));

    const { checkKeywordRanking } = await loadClient();
    const found = checkKeywordRanking(LOOKUP, undefined, 'req-found');
    await vi.runAllTimersAsync();
    await found;

    expect(info.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'domain found at position',
    );

    info.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(serpPayload(organicItems(20, null)))));
    const missing = checkKeywordRanking(LOOKUP, undefined, 'req-missing');
    await vi.runAllTimersAsync();
    await missing;

    expect(info.mock.calls.map((c) => String(c[0])).join('\n')).toContain('domain not found');
  });
});
