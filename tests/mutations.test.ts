import { describe, expect, it } from 'vitest';

import {
  MAX_BULK_DELETE,
  bulkDeleteKeywordsSchema,
  clearKeywordsSchema,
  deleteKeywordQuerySchema,
  idParamSchema,
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
    expect(updateProjectSchema.safeParse({ devices: ['DESKTOP'] }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ devices: ['MOBILE'] }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ devices: ['DESKTOP', 'MOBILE'] }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ devices: ['TABLET'] }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ devices: ['desktop'] }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ devices: [] }).success).toBe(false);
  });

});

describe('updateProjectSchema: website and Google property', () => {
  it('accepts a website and normalizes it the same way creation does', () => {
    const parsed = updateProjectSchema.safeParse({
      domain: 'https://WWW.Wroffy.com/pricing?a=1',
      confirmDomainChange: true,
    });

    expect(parsed.success && parsed.data.domain).toBe('wroffy.com');
  });

  it('rejects a website that is not a hostname', () => {
    expect(updateProjectSchema.safeParse({ domain: 'not a domain' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ domain: '' }).success).toBe(false);
  });

  it('does not treat the confirmation flag on its own as an edit', () => {
    // Otherwise "confirm and change nothing" would look like a real update.
    expect(updateProjectSchema.safeParse({ confirmDomainChange: true }).success).toBe(false);
  });

  it('accepts a supported Google property and rejects anything else', () => {
    expect(updateProjectSchema.safeParse({ googleDomain: 'google.co.in' }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ googleDomain: 'google.com' }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ googleDomain: 'bing.com' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ googleDomain: 'google.evil.com' }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ googleDomain: '' }).success).toBe(false);
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

describe('idParamSchema', () => {
  it('accepts an id-shaped value and trims it', () => {
    const parsed = idParamSchema.safeParse('  clx1234567890abcdef  ');
    expect(parsed.success && parsed.data).toBe('clx1234567890abcdef');
  });

  it('rejects an empty or over-long id', () => {
    expect(idParamSchema.safeParse('').success).toBe(false);
    expect(idParamSchema.safeParse('   ').success).toBe(false);
    expect(idParamSchema.safeParse('a'.repeat(61)).success).toBe(false);
  });

  it('rejects a non-string id', () => {
    expect(idParamSchema.safeParse(null).success).toBe(false);
    expect(idParamSchema.safeParse(42).success).toBe(false);
  });
});

describe('deleteKeywordQuerySchema', () => {
  it('requires a keywordId', () => {
    expect(deleteKeywordQuerySchema.safeParse({ keywordId: 'abc' }).success).toBe(true);
    expect(deleteKeywordQuerySchema.safeParse({}).success).toBe(false);
    expect(deleteKeywordQuerySchema.safeParse({ keywordId: '' }).success).toBe(false);
  });
});
