import { describe, expect, it } from 'vitest';

import {
  MAX_KEYWORD_LENGTH,
  parseKeywordCsv,
  parseKeywordList,
  sanitizeCsvValue,
  toCsv,
} from '@/lib/csv';

describe('parseKeywordCsv — valid input', () => {
  it('parses a single keyword column', () => {
    const result = parseKeywordCsv(
      ['keyword', 'microsoft reseller india', 'azure reseller india', 'microsoft partner india'].join('\n'),
    );

    expect(result.errors).toEqual([]);
    expect(result.keywords.map((k) => k.keyword)).toEqual([
      'microsoft reseller india',
      'azure reseller india',
      'microsoft partner india',
    ]);
    expect(result.keywords.every((k) => k.targetUrl === null)).toBe(true);
  });

  it('parses keyword + targetUrl', () => {
    const result = parseKeywordCsv(
      [
        'keyword,targetUrl',
        'microsoft reseller india,/microsoft-reseller',
        'azure reseller india,/azure',
      ].join('\n'),
    );

    expect(result.keywords).toEqual([
      { keyword: 'microsoft reseller india', targetUrl: '/microsoft-reseller' },
      { keyword: 'azure reseller india', targetUrl: '/azure' },
    ]);
  });

  it('accepts alternative header spellings', () => {
    const result = parseKeywordCsv('Keyword,Target URL\nfoo bar,/foo');
    expect(result.keywords).toEqual([{ keyword: 'foo bar', targetUrl: '/foo' }]);
  });

  it('accepts a headerless single-column list', () => {
    const result = parseKeywordCsv('microsoft reseller india\nazure reseller india');
    expect(result.keywords.map((k) => k.keyword)).toEqual([
      'microsoft reseller india',
      'azure reseller india',
    ]);
  });

  it('turns a relative target into a leading-slash path', () => {
    const result = parseKeywordCsv('keyword,targetUrl\nfoo,microsoft-reseller');
    expect(result.keywords[0].targetUrl).toBe('/microsoft-reseller');
  });
});

describe('parseKeywordCsv — cleaning', () => {
  it('trims whitespace and collapses internal runs', () => {
    const result = parseKeywordCsv('keyword\n   microsoft   reseller india   ');
    expect(result.keywords[0].keyword).toBe('microsoft reseller india');
  });

  it('removes empty rows', () => {
    const result = parseKeywordCsv('keyword\nfoo\n\n   \nbar\n');
    expect(result.keywords.map((k) => k.keyword)).toEqual(['foo', 'bar']);
  });

  it('removes duplicates case-insensitively and counts them', () => {
    const result = parseKeywordCsv('keyword\nfoo\nFOO\n Foo \nbar');
    expect(result.keywords.map((k) => k.keyword)).toEqual(['foo', 'bar']);
    expect(result.duplicates).toBe(2);
  });

  it('strips a UTF-8 BOM', () => {
    const result = parseKeywordCsv('﻿keyword\nfoo');
    expect(result.keywords.map((k) => k.keyword)).toEqual(['foo']);
  });

  it('handles quoted fields containing commas', () => {
    const result = parseKeywordCsv('keyword,targetUrl\n"microsoft, azure reseller",/x');
    expect(result.keywords[0].keyword).toBe('microsoft, azure reseller');
  });

  it('keeps non-ASCII characters intact', () => {
    const result = parseKeywordCsv('keyword\nमाइक्रोसॉफ्ट रीसेलर\ncafé münchen');
    expect(result.keywords.map((k) => k.keyword)).toEqual([
      'माइक्रोसॉफ्ट रीसेलर',
      'café münchen',
    ]);
  });

  it('skips keywords longer than the limit', () => {
    const long = 'a'.repeat(MAX_KEYWORD_LENGTH + 1);
    const result = parseKeywordCsv(`keyword\nok keyword\n${long}`);
    expect(result.keywords.map((k) => k.keyword)).toEqual(['ok keyword']);
    expect(result.skippedRows).toBe(1);
  });
});

describe('parseKeywordCsv — invalid input', () => {
  it('rejects an empty file', () => {
    expect(parseKeywordCsv('').errors[0]).toMatch(/empty/i);
    expect(parseKeywordCsv('   \n  ').errors[0]).toMatch(/empty/i);
  });

  it('rejects a file with no keyword column', () => {
    const result = parseKeywordCsv('position,url\n1,https://example.com');
    expect(result.keywords).toEqual([]);
    expect(result.errors[0]).toMatch(/keyword.*column/i);
  });

  it('reports when only a header row is present', () => {
    const result = parseKeywordCsv('keyword');
    expect(result.keywords).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('caps the number of imported keywords', () => {
    const rows = Array.from({ length: 30 }, (_, i) => `keyword ${i}`).join('\n');
    const result = parseKeywordCsv(`keyword\n${rows}`, { maxKeywords: 10 });
    expect(result.keywords).toHaveLength(10);
    expect(result.truncated).toBe(20);
    expect(result.errors[0]).toMatch(/only the first 10/i);
  });

  it('handles a large file', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `keyword number ${i}`).join('\n');
    const result = parseKeywordCsv(`keyword\n${rows}`);
    expect(result.keywords).toHaveLength(5000);
    expect(result.duplicates).toBe(0);
  });
});

describe('parseKeywordList', () => {
  it('parses one keyword per line and removes blanks and duplicates', () => {
    const result = parseKeywordList(
      [
        'microsoft reseller india',
        '',
        '  azure reseller india  ',
        'microsoft partner india',
        'MICROSOFT RESELLER INDIA',
        '   ',
        'microsoft 365 reseller',
      ].join('\n'),
    );

    expect(result.keywords.map((k) => k.keyword)).toEqual([
      'microsoft reseller india',
      'azure reseller india',
      'microsoft partner india',
      'microsoft 365 reseller',
    ]);
    expect(result.duplicates).toBe(1);
  });

  it('handles CRLF line endings', () => {
    const result = parseKeywordList('foo\r\nbar\r\n');
    expect(result.keywords.map((k) => k.keyword)).toEqual(['foo', 'bar']);
  });

  it('reports an error for an empty paste', () => {
    expect(parseKeywordList('').keywords).toEqual([]);
    expect(parseKeywordList('').errors.length).toBeGreaterThan(0);
  });
});

describe('sanitizeCsvValue — formula injection', () => {
  it('neutralizes every formula trigger character', () => {
    expect(sanitizeCsvValue('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvValue('+1')).toBe("'+1");
    expect(sanitizeCsvValue('-1')).toBe("'-1");
    expect(sanitizeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeCsvValue('=HYPERLINK("http://evil","click")')).toBe(
      '\'=HYPERLINK("http://evil","click")',
    );
  });

  it('neutralizes triggers hidden behind leading control characters', () => {
    expect(sanitizeCsvValue('\t=cmd')).toBe("'=cmd");
    expect(sanitizeCsvValue('\r@SUM(1)')).toBe("'@SUM(1)");
    expect(sanitizeCsvValue('  =1+1')).toBe("'=1+1");
  });

  it('leaves ordinary values alone', () => {
    expect(sanitizeCsvValue('microsoft reseller india')).toBe('microsoft reseller india');
    expect(sanitizeCsvValue('https://wroffy.com/a')).toBe('https://wroffy.com/a');
    expect(sanitizeCsvValue('')).toBe('');
    expect(sanitizeCsvValue('4')).toBe('4');
  });

  it('is applied when keywords are imported', () => {
    const result = parseKeywordCsv('keyword\n=cmd|calc');
    expect(result.keywords[0].keyword).toBe("'=cmd|calc");
  });
});

describe('toCsv', () => {
  it('writes a header row and quotes fields that need it', () => {
    const csv = toCsv(
      ['keyword', 'position', 'change', 'ranking_url', 'checked_at'],
      [
        ['microsoft reseller india', 4, 3, 'https://wroffy.com/microsoft', '2026-09-02T14:30:00'],
        ['azure, reseller india', 8, -2, 'https://wroffy.com/azure', '2026-09-02T14:31:00'],
      ],
    );

    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('keyword,position,change,ranking_url,checked_at');
    expect(lines[1]).toBe(
      'microsoft reseller india,4,3,https://wroffy.com/microsoft,2026-09-02T14:30:00',
    );
    expect(lines[2]).toContain('"azure, reseller india"');
  });

  it('escapes embedded quotes and newlines', () => {
    const csv = toCsv(['a'], [['say "hi"'], ['line1\nline2']]);
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it('de-fangs formulas on export', () => {
    const csv = toCsv(['keyword'], [['=cmd|calc']]);
    expect(csv).toContain("'=cmd|calc");
    expect(csv).not.toMatch(/^keyword\r\n=cmd/);
  });

  it('renders null as an empty cell', () => {
    const csv = toCsv(['a', 'b'], [['x', null]]);
    expect(csv.trim().split('\r\n')[1]).toBe('x,');
  });
});
