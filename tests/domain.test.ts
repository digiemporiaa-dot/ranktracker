import { describe, expect, it } from 'vitest';

import {
  hostMatchesDomain,
  hostnameFromUrl,
  normalizeDomain,
  normalizeTargetUrl,
  stripWww,
  urlMatchesDomain,
} from '@/lib/domain';

describe('normalizeDomain', () => {
  it('reduces a full URL to a bare host', () => {
    expect(normalizeDomain('https://www.wroffy.com/')).toBe('wroffy.com');
    expect(normalizeDomain('https://www.wroffy.com/pricing?a=1#top')).toBe('wroffy.com');
    expect(normalizeDomain('http://wroffy.com')).toBe('wroffy.com');
  });

  it('lowercases, trims and drops trailing dots and ports', () => {
    expect(normalizeDomain('  WWW.WROFFY.COM.  ')).toBe('wroffy.com');
    expect(normalizeDomain('wroffy.com:8443')).toBe('wroffy.com');
  });

  it('keeps subdomains other than www', () => {
    expect(normalizeDomain('https://blog.wroffy.com')).toBe('blog.wroffy.com');
  });

  it('drops credentials', () => {
    expect(normalizeDomain('https://user:pass@wroffy.com/x')).toBe('wroffy.com');
  });

  it('rejects input that is not a hostname', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('192.168.0.1')).toBeNull();
    expect(normalizeDomain('wroffy..com')).toBeNull();
  });
});

describe('stripWww', () => {
  it('removes only a leading www label', () => {
    expect(stripWww('www.wroffy.com')).toBe('wroffy.com');
    expect(stripWww('wwwx.wroffy.com')).toBe('wwwx.wroffy.com');
    expect(stripWww('blog.www.wroffy.com')).toBe('blog.www.wroffy.com');
  });
});

describe('hostnameFromUrl', () => {
  it('extracts the host from http(s) URLs', () => {
    expect(hostnameFromUrl('https://blog.wroffy.com/a/b')).toBe('blog.wroffy.com');
  });

  it('rejects non-http schemes and junk', () => {
    expect(hostnameFromUrl('javascript:alert(1)')).toBeNull();
    expect(hostnameFromUrl('ftp://wroffy.com')).toBeNull();
    expect(hostnameFromUrl('not a url')).toBeNull();
    expect(hostnameFromUrl('')).toBeNull();
  });
});

describe('hostMatchesDomain — the domain itself and its subdomains match', () => {
  const matching = ['wroffy.com', 'www.wroffy.com', 'blog.wroffy.com', 'shop.wroffy.com'];

  for (const host of matching) {
    it(`matches ${host}`, () => {
      expect(hostMatchesDomain(host, 'wroffy.com')).toBe(true);
    });
  }

  it('matches regardless of how the target was written', () => {
    expect(hostMatchesDomain('blog.wroffy.com', 'https://www.wroffy.com/')).toBe(true);
    expect(hostMatchesDomain('WWW.Wroffy.COM', 'wroffy.com')).toBe(true);
  });
});

describe('hostMatchesDomain — lookalikes must not match', () => {
  const notMatching = [
    'fakewroffy.com',
    'wroffy.com.fake.com',
    'notwroffy.com',
    'wroffy.co',
    'wroffy.com.evil.co.uk',
    'xwroffy.com',
  ];

  for (const host of notMatching) {
    it(`rejects ${host}`, () => {
      expect(hostMatchesDomain(host, 'wroffy.com')).toBe(false);
    });
  }

  it('rejects empty input', () => {
    expect(hostMatchesDomain('', 'wroffy.com')).toBe(false);
    expect(hostMatchesDomain('wroffy.com', '')).toBe(false);
  });
});

describe('urlMatchesDomain', () => {
  it('matches real URLs on the domain', () => {
    expect(urlMatchesDomain('https://wroffy.com/page', 'wroffy.com')).toBe(true);
    expect(urlMatchesDomain('https://www.wroffy.com/page', 'wroffy.com')).toBe(true);
    expect(urlMatchesDomain('https://blog.wroffy.com/page', 'wroffy.com')).toBe(true);
    expect(urlMatchesDomain('https://shop.wroffy.com/page', 'wroffy.com')).toBe(true);
  });

  it('is not fooled by the domain appearing in the path or as a prefix', () => {
    expect(urlMatchesDomain('https://example.com/wroffy.com', 'wroffy.com')).toBe(false);
    expect(urlMatchesDomain('https://fakewroffy.com/page', 'wroffy.com')).toBe(false);
    expect(urlMatchesDomain('https://wroffy.com.fake.com/page', 'wroffy.com')).toBe(false);
    expect(urlMatchesDomain('https://example.com/?q=wroffy.com', 'wroffy.com')).toBe(false);
    expect(urlMatchesDomain('https://example.com/#wroffy.com', 'wroffy.com')).toBe(false);
  });
});

describe('normalizeTargetUrl', () => {
  it('keeps absolute URLs and normalizes paths', () => {
    expect(normalizeTargetUrl('https://wroffy.com/a')).toBe('https://wroffy.com/a');
    expect(normalizeTargetUrl('/microsoft-reseller')).toBe('/microsoft-reseller');
    expect(normalizeTargetUrl('microsoft-reseller')).toBe('/microsoft-reseller');
    expect(normalizeTargetUrl('  ')).toBeNull();
    expect(normalizeTargetUrl(null)).toBeNull();
  });
});
