import { describe, expect, it } from 'vitest';

import {
  addKeywordsSchema,
  createProjectSchema,
  updateProjectSchema,
} from '@/lib/validation';
import { groupByDevice, matchesDevice } from '@/lib/ranking';
import { COUNTRIES, COUNTRY_CODES } from '@/config/serp';

/**
 * Location and device rules, at the level where they are decided.
 *
 * The validation half is what a request has to satisfy before it can reach the
 * database; the grouping half is what the dashboard is allowed to put on one
 * line. Neither may ever combine a desktop reading with a mobile one, or a
 * reading from one place with a reading from another.
 */

const base = { name: 'Wroffy India', domain: 'https://wroffy.com' };

describe('location validation', () => {
  it('accepts a country on its own', () => {
    const parsed = createProjectSchema.safeParse({ ...base, country: 'IN' });
    expect(parsed.success).toBe(true);
    // No city means the whole country, which the resolver reads as null.
    if (parsed.success) expect(parsed.data.city ?? null).toBeNull();
  });

  it('accepts a country with a city', () => {
    const parsed = createProjectSchema.safeParse({
      ...base,
      country: 'IN',
      city: 'New Delhi,Delhi',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.city).toBe('New Delhi,Delhi');
  });

  it('treats an empty or whitespace city as no city at all', () => {
    for (const city of ['', '   ']) {
      const parsed = createProjectSchema.safeParse({ ...base, country: 'IN', city });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.city).toBeNull();
    }
  });

  it('accepts an explicit null city', () => {
    const parsed = createProjectSchema.safeParse({ ...base, country: 'IN', city: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.city).toBeNull();
  });

  it('rejects a city without a country', () => {
    expect(createProjectSchema.safeParse({ ...base, city: 'New Delhi' }).success).toBe(false);
  });

  it('rejects a missing country', () => {
    expect(createProjectSchema.safeParse(base).success).toBe(false);
  });

  it('rejects a country outside the configured list', () => {
    expect(createProjectSchema.safeParse({ ...base, country: 'ZZ' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, country: 'in' }).success).toBe(false);
  });

  it('never accepts a location id from the caller', () => {
    const parsed = createProjectSchema.safeParse({
      ...base,
      country: 'IN',
      // Someone trying to pin the search to a location of their choosing.
      locationCode: 2840,
      locationId: 2840,
    });

    expect(parsed.success).toBe(true);
    // The keys are stripped, so neither can reach the database.
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('locationCode');
      expect(parsed.data).not.toHaveProperty('locationId');
    }
  });

  it('never accepts a Google domain from the caller', () => {
    const parsed = createProjectSchema.safeParse({
      ...base,
      country: 'IN',
      googleDomain: 'example.com',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty('googleDomain');
  });

  it('lets an edit clear the city back to country level', () => {
    const parsed = updateProjectSchema.safeParse({ city: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.city).toBeNull();
  });
});

describe('device validation', () => {
  const withDevices = (devices: unknown) =>
    createProjectSchema.safeParse({ ...base, country: 'IN', devices });

  it('accepts desktop only', () => {
    const parsed = withDevices(['DESKTOP']);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.devices).toEqual(['DESKTOP']);
  });

  it('accepts mobile only', () => {
    const parsed = withDevices(['MOBILE']);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.devices).toEqual(['MOBILE']);
  });

  it('accepts desktop and mobile together', () => {
    const parsed = withDevices(['DESKTOP', 'MOBILE']);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.devices).toEqual(['DESKTOP', 'MOBILE']);
  });

  it('rejects an empty device list', () => {
    expect(withDevices([]).success).toBe(false);
  });

  it('rejects an unknown device', () => {
    expect(withDevices(['TABLET']).success).toBe(false);
    expect(withDevices(['desktop']).success).toBe(false);
    expect(withDevices(['DESKTOP', 'TABLET']).success).toBe(false);
    expect(withDevices('DESKTOP').success).toBe(false);
  });

  it('collapses a repeated device rather than tracking it twice', () => {
    const parsed = withDevices(['DESKTOP', 'DESKTOP']);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.devices).toEqual(['DESKTOP']);
  });

  it('defaults to desktop when the caller says nothing', () => {
    const parsed = createProjectSchema.safeParse({ ...base, country: 'IN' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.devices).toEqual(['DESKTOP']);
  });

  it('applies the same rules when keywords are added', () => {
    expect(addKeywordsSchema.safeParse({ text: 'a', devices: ['MOBILE'] }).success).toBe(true);
    expect(addKeywordsSchema.safeParse({ text: 'a', devices: [] }).success).toBe(false);
    expect(addKeywordsSchema.safeParse({ text: 'a', devices: ['WATCH'] }).success).toBe(false);
  });
});

describe('google domains', () => {
  it('gives every supported country its own Google property', () => {
    expect(COUNTRIES.IN.googleDomain).toBe('google.co.in');
    expect(COUNTRIES.US.googleDomain).toBe('google.com');
    expect(COUNTRIES.GB.googleDomain).toBe('google.co.uk');
    expect(COUNTRIES.CA.googleDomain).toBe('google.ca');
    expect(COUNTRIES.AU.googleDomain).toBe('google.com.au');
  });

  it('configures a domain and a location code for every country offered', () => {
    for (const code of COUNTRY_CODES) {
      expect(COUNTRIES[code].googleDomain).toMatch(/^google\./);
      expect(Number.isInteger(COUNTRIES[code].locationCode)).toBe(true);
    }
  });
});

/** A row as the table sees it: one keyword, on one device, in one place. */
const row = (
  id: string,
  keyword: string,
  device: string,
  position: number | null,
  locationCode = 2356,
) => ({ id, keyword, device, position, locationCode, language: 'en' });

describe('keeping devices apart', () => {
  const rows = [
    row('d1', 'autodesk reseller', 'DESKTOP', 7),
    row('m1', 'autodesk reseller', 'MOBILE', 11),
    row('d2', 'autocad reseller', 'DESKTOP', 4),
    row('m2', 'autocad reseller', 'MOBILE', 6),
    row('d3', 'revit reseller', 'DESKTOP', 12),
  ];

  it('filters to one device without touching the other', () => {
    expect(matchesDevice(rows, 'DESKTOP').map((r) => r.id)).toEqual(['d1', 'd2', 'd3']);
    expect(matchesDevice(rows, 'MOBILE').map((r) => r.id)).toEqual(['m1', 'm2']);
    expect(matchesDevice(rows, 'all')).toHaveLength(5);
  });

  it('puts each device in its own column on one line', () => {
    const groups = groupByDevice(rows);

    expect(groups).toHaveLength(3);
    expect(groups[0].keyword).toBe('autodesk reseller');
    expect(groups[0].desktop?.position).toBe(7);
    expect(groups[0].mobile?.position).toBe(11);
    expect(groups[1].desktop?.position).toBe(4);
    expect(groups[1].mobile?.position).toBe(6);
  });

  it('shows nothing for a device that is not tracked, never the other one', () => {
    const groups = groupByDevice(rows);
    const revit = groups.find((group) => group.keyword === 'revit reseller');

    expect(revit?.desktop?.position).toBe(12);
    // The keyword has no mobile row: it stays empty rather than borrowing #12.
    expect(revit?.mobile).toBeNull();
  });

  it('keeps both keyword ids on the line so a delete removes both', () => {
    const groups = groupByDevice(rows);
    expect(groups[0].keywordIds.sort()).toEqual(['d1', 'm1']);
    expect(groups[2].keywordIds).toEqual(['d3']);
  });
});

describe('keeping locations apart', () => {
  it('never merges the same keyword measured in two places', () => {
    const groups = groupByDevice([
      row('nation-d', 'autodesk reseller', 'DESKTOP', 7, 2356),
      row('delhi-d', 'autodesk reseller', 'DESKTOP', 3, 9061259),
      row('delhi-m', 'autodesk reseller', 'MOBILE', 5, 9061259),
    ]);

    expect(groups).toHaveLength(2);

    const nationwide = groups.find((group) => group.locationCode === 2356);
    const delhi = groups.find((group) => group.locationCode === 9061259);

    expect(nationwide?.desktop?.position).toBe(7);
    expect(nationwide?.mobile).toBeNull();
    expect(delhi?.desktop?.position).toBe(3);
    expect(delhi?.mobile?.position).toBe(5);
  });

  it('does not merge across languages either', () => {
    const groups = groupByDevice([
      { ...row('en', 'reseller', 'DESKTOP', 4), language: 'en' },
      { ...row('hi', 'reseller', 'DESKTOP', 9), language: 'hi' },
    ]);
    expect(groups).toHaveLength(2);
  });
});
