import { describe, expect, it } from 'vitest';

import {
  MAX_BULK_DELETE,
  bulkDeleteKeywordsSchema,
  clearKeywordsSchema,
  updateProjectSchema,
} from '@/lib/validation';

describe('updateProjectSchema', () => {
  it('accepts a partial update', () => {
    const parsed = updateProjectSchema.safeParse({ name: 'Renamed' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ name: 'Renamed' });
  });

  it('trims the name', () => {
    const parsed = updateProjectSchema.safeParse({ name: '  Wroffy India  ' });
    expect(parsed.success && parsed.data.name).toBe('Wroffy India');
  });

  it('rejects an empty body', () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty or over-long name', () => {
    expect(updateProjectSchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
  });

  it('rejects a country outside the configured list', () => {
    expect(updateProjectSchema.safeParse({ country: 'IN' }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ country: 'ZZ' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ country: 'in' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ country: '' }).success).toBe(false);
  });

  it('rejects a language outside the configured list', () => {
    expect(updateProjectSchema.safeParse({ language: 'en' }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ language: 'fr' }).success).toBe(false);
  });

  it('rejects a device outside the configured list', () => {
    expect(updateProjectSchema.safeParse({ device: 'DESKTOP' }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ device: 'MOBILE' }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ device: 'TABLET' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ device: 'desktop' }).success).toBe(false);
  });

  it('does not accept a domain change', () => {
    const parsed = updateProjectSchema.safeParse({
      name: 'Renamed',
      domain: 'someone-else.com',
    });
    // The key is stripped, so a domain can never reach the update.
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty('domain');
  });
});

describe('bulkDeleteKeywordsSchema', () => {
  it('accepts a list of ids', () => {
    const parsed = bulkDeleteKeywordsSchema.safeParse({ keywordIds: ['a', 'b'] });
    expect(parsed.success && parsed.data.keywordIds).toEqual(['a', 'b']);
  });

  it('rejects an empty list', () => {
    expect(bulkDeleteKeywordsSchema.safeParse({ keywordIds: [] }).success).toBe(false);
  });

  it('rejects more than the cap', () => {
    const ok = Array.from({ length: MAX_BULK_DELETE }, (_, i) => `k${i}`);
    expect(bulkDeleteKeywordsSchema.safeParse({ keywordIds: ok }).success).toBe(true);
    expect(
      bulkDeleteKeywordsSchema.safeParse({ keywordIds: [...ok, 'one-too-many'] }).success,
    ).toBe(false);
  });

  it('rejects non-string and empty ids', () => {
    expect(bulkDeleteKeywordsSchema.safeParse({ keywordIds: [1, 2] }).success).toBe(false);
    expect(bulkDeleteKeywordsSchema.safeParse({ keywordIds: [''] }).success).toBe(false);
    expect(bulkDeleteKeywordsSchema.safeParse({}).success).toBe(false);
  });
});

describe('clearKeywordsSchema', () => {
  it('requires a non-empty confirm string', () => {
    expect(clearKeywordsSchema.safeParse({ confirm: 'Wroffy India' }).success).toBe(true);
    expect(clearKeywordsSchema.safeParse({ confirm: '' }).success).toBe(false);
    expect(clearKeywordsSchema.safeParse({}).success).toBe(false);
  });
});
