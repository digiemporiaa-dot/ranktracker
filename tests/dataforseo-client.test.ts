import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the DataForSEO transport: how it authenticates, what it retries,
 * and what it refuses to leak. `fetch` is stubbed — no network is touched.
 */

const LIVE_PATH = '/v3/serp/google/organic/live/advanced';

async function loadClient(env: Record<string, string> = {}) {
  vi.resetModules();
  process.env.DATAFORSEO_LOGIN = env.DATAFORSEO_LOGIN ?? 'test-login';
  process.env.DATAFORSEO_PASSWORD = env.DATAFORSEO_PASSWORD ?? 'test-password';
  return import('@/lib/dataforseo');
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const okPayload = {
  status_code: 20000,
  tasks: [
    {
      result: [
        {
          items: [
            { type: 'paid', rank_absolute: 1, url: 'https://ad.com/' },
            { type: 'organic', rank_absolute: 2, url: 'https://wroffy.com/x', domain: 'wroffy.com' },
          ],
        },
      ],
    },
  ],
};

describe('DataForSEO transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts to the live advanced endpoint with Basic auth and a task array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okPayload));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    await fetchSerp(
      {
        keyword: 'microsoft reseller india',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 100,
      },
      'req-1',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(`https://api.dataforseo.com${LIVE_PATH}`);
    expect(init.method).toBe('POST');

    // Basic auth, base64 of login:password.
    const expected = `Basic ${Buffer.from('test-login:test-password').toString('base64')}`;
    expect(init.headers.Authorization).toBe(expected);

    // The live endpoint takes an array holding a single task.
    const body = JSON.parse(init.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      keyword: 'microsoft reseller india',
      location_code: 2356,
      language_code: 'en',
      device: 'desktop',
      depth: 100,
      se_domain: 'google.co.in',
    });
  });

  it('retries transient network failures with backoff, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(jsonResponse(okPayload));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-2',
    );

    await vi.runAllTimersAsync();
    const organic = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(organic).toHaveLength(1);
    expect(organic[0].position).toBe(1);
  });

  it('gives up after 3 attempts on a persistent transient failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp, DataForSeoError } = await loadClient();
    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-3',
    ).catch((error) => error);

    await vi.runAllTimersAsync();
    const error = await promise;

    expect(error).toBeInstanceOf(DataForSeoError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The user-facing message never mentions the transport.
    expect(error.userMessage).toBe('Unable to check this keyword right now. Please try again.');
    expect(error.userMessage).not.toMatch(/ECONNRESET|fetch|axios/i);
  });

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-4',
    ).catch((error) => error);

    await vi.runAllTimersAsync();
    const error = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toMatch(/credentials/i);
  });

  it('does not retry a payment-required failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 402));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-5',
    ).catch((error) => error);

    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries HTTP 429 and 5xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValue(jsonResponse(okPayload));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-6',
    );

    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats a non-20000 API status_code as an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status_code: 40200, status_message: 'Payment Required' }));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-7',
    ).catch((error) => error);

    await vi.runAllTimersAsync();
    const error = await promise;

    // 40xxx is a client-side problem: not retried.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.retryable).toBe(false);
  });

  it('retries a 5xxxx provider status_code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status_code: 50000, status_message: 'Internal Error' }))
      .mockResolvedValue(jsonResponse(okPayload));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient();
    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-8',
    );

    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses to call the provider when credentials are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp, DataForSeoNotConfiguredError } = await loadClient({
      DATAFORSEO_LOGIN: '',
      DATAFORSEO_PASSWORD: '',
    });

    await expect(
      fetchSerp(
        {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
        'req-9',
      ),
    ).rejects.toBeInstanceOf(DataForSeoNotConfiguredError);

    // Never returns invented ranking data, and never opens a connection.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never puts credentials in the request body or the thrown error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSerp } = await loadClient({
      DATAFORSEO_LOGIN: 'secret-login',
      DATAFORSEO_PASSWORD: 'secret-password',
    });

    const promise = fetchSerp(
      {
        keyword: 'k',
        domain: 'wroffy.com',
        country: 'IN',
        city: null,
        locationCode: 2356,
        googleDomain: 'google.co.in',
        language: 'en',
        device: 'DESKTOP',
        results: 10,
      },
      'req-10',
    ).catch((error) => error);

    await vi.runAllTimersAsync();
    const error = await promise;

    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).not.toContain('secret-login');
    expect(body).not.toContain('secret-password');

    const serialized = `${error.message} ${error.userMessage} ${error.stack ?? ''}`;
    expect(serialized).not.toContain('secret-login');
    expect(serialized).not.toContain('secret-password');
  });
});
