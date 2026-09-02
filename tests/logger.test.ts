import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger, __testing } from '@/lib/logger';

describe('logger redaction', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DATAFORSEO_LOGIN = 'my-serp-login';
    process.env.DATAFORSEO_PASSWORD = 'my-serp-password';
    process.env.SESSION_SECRET = 'my-session-secret-value';
    process.env.DATABASE_URL = 'postgresql://user:pw@db:5432/app';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('redacts secret-looking keys regardless of their value', () => {
    const redacted = __testing.redact({
      password: 'hunter2',
      DATAFORSEO_PASSWORD: 'x',
      authorization: 'Basic abc',
      apiKey: 'k',
      cookie: 'session=1',
      keyword: 'microsoft reseller india',
    }) as Record<string, unknown>;

    expect(redacted.password).toBe('[redacted]');
    expect(redacted.DATAFORSEO_PASSWORD).toBe('[redacted]');
    expect(redacted.authorization).toBe('[redacted]');
    expect(redacted.apiKey).toBe('[redacted]');
    expect(redacted.cookie).toBe('[redacted]');
    // Ordinary fields survive.
    expect(redacted.keyword).toBe('microsoft reseller india');
  });

  it('scrubs secret values that appear inside free text', () => {
    const scrubbed = __testing.scrubString(
      'connecting as my-serp-login with my-serp-password to postgresql://user:pw@db:5432/app',
    );
    expect(scrubbed).not.toContain('my-serp-login');
    expect(scrubbed).not.toContain('my-serp-password');
    expect(scrubbed).not.toContain('postgresql://user:pw@db:5432/app');
  });

  it('scrubs Basic and Bearer credentials', () => {
    expect(__testing.scrubString('Authorization: Basic YWJjOmRlZg==')).toContain(
      'Basic [redacted]',
    );
    expect(__testing.scrubString('Bearer eyJhbGciOi.abc')).toContain('Bearer [redacted]');
  });

  it('redacts secrets nested in errors written to the log', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error('keyword check failed', {
      keywordId: 'kw_1',
      error: new Error('auth failed for my-serp-login / my-serp-password'),
    });

    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain('my-serp-login');
    expect(line).not.toContain('my-serp-password');
    expect(line).toContain('kw_1');
  });

  it('writes the fields the spec requires', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logger.info('keyword checked', {
      requestId: 'req_1',
      userId: 'u_1',
      projectId: 'p_1',
      keywordId: 'k_1',
      status: 'ok',
      durationMs: 421,
    });

    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line).toMatchObject({
      level: 'info',
      message: 'keyword checked',
      requestId: 'req_1',
      userId: 'u_1',
      projectId: 'p_1',
      keywordId: 'k_1',
      status: 'ok',
      durationMs: 421,
    });
  });

  it('survives circular and exotic values', () => {
    const circular: Record<string, unknown> = { name: 'x' };
    circular.self = circular;
    expect(() => __testing.redact(circular)).not.toThrow();
    expect(() => __testing.redact(() => undefined)).not.toThrow();
  });
});
