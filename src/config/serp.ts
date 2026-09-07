/**
 * Centralized SERP configuration.
 *
 * `locationCode` values are DataForSEO location identifiers for the country as
 * a whole. DataForSEO reuses Google's geo target constant IDs, which are the
 * ISO-3166-1 numeric country code + 2000 (e.g. India = 356 -> 2356).
 *
 * Verify them against your own account at any time with:
 *   npm run dataforseo:locations
 * which calls GET /v3/serp/google/locations and asserts each code below.
 */

export type CountryCode = 'IN' | 'US' | 'GB' | 'CA' | 'AU' | 'AE' | 'SG';

export type CountryConfig = {
  code: CountryCode;
  label: string;
  /** DataForSEO `location_code` for the country as a whole. */
  locationCode: number;
  /** DataForSEO `location_name`, sent alongside for traceability in logs. */
  locationName: string;
  /**
   * The Google property searched for this country, sent as `se_domain`.
   *
   * DataForSEO defaults `se_domain` to whichever Google property matches the
   * location, so these values agree with the provider's own default rather
   * than overriding it.
   */
  googleDomain: string;
};

export const COUNTRIES: Record<CountryCode, CountryConfig> = {
  IN: {
    code: 'IN',
    label: 'India',
    locationCode: 2356,
    locationName: 'India',
    googleDomain: 'google.co.in',
  },
  US: {
    code: 'US',
    label: 'United States',
    locationCode: 2840,
    locationName: 'United States',
    googleDomain: 'google.com',
  },
  GB: {
    code: 'GB',
    label: 'United Kingdom',
    locationCode: 2826,
    locationName: 'United Kingdom',
    googleDomain: 'google.co.uk',
  },
  CA: {
    code: 'CA',
    label: 'Canada',
    locationCode: 2124,
    locationName: 'Canada',
    googleDomain: 'google.ca',
  },
  AU: {
    code: 'AU',
    label: 'Australia',
    locationCode: 2036,
    locationName: 'Australia',
    googleDomain: 'google.com.au',
  },
  AE: {
    code: 'AE',
    label: 'United Arab Emirates',
    locationCode: 2784,
    locationName: 'United Arab Emirates',
    googleDomain: 'google.ae',
  },
  SG: {
    code: 'SG',
    label: 'Singapore',
    locationCode: 2702,
    locationName: 'Singapore',
    googleDomain: 'google.com.sg',
  },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

/**
 * Google properties a project may be checked against.
 *
 * Each country has a local Google, which is what a project uses unless it is
 * given an explicit one. The override exists because the two are not always
 * interchangeable: google.com and google.co.in can answer the same
 * India-located query differently, and which one is "right" depends on who the
 * site is actually trying to reach.
 */
export const GOOGLE_DOMAINS: string[] = Array.from(
  new Set(['google.com', ...COUNTRY_CODES.map((code) => COUNTRIES[code].googleDomain)]),
).sort();

/** The local Google for a country. Used as the default, never forced. */
export function googleDomainFor(country: string): string {
  return COUNTRIES[country as CountryCode]?.googleDomain ?? 'google.com';
}
export const DEFAULT_COUNTRY: CountryCode = 'IN';

export function getCountry(code: string): CountryConfig {
  const country = COUNTRIES[code as CountryCode];
  if (!country) throw new Error(`Unsupported country code: ${code}`);
  return country;
}

/**
 * Languages. Only English ships in V1; the shape is here so adding a language
 * is a one-line change and nothing else in the codebase moves.
 */
export type LanguageCode = 'en';

export type LanguageConfig = {
  code: LanguageCode;
  label: string;
  /** DataForSEO `language_code`. */
  languageCode: string;
  /** DataForSEO `language_name`. */
  languageName: string;
};

export const LANGUAGES: Record<LanguageCode, LanguageConfig> = {
  en: { code: 'en', label: 'English', languageCode: 'en', languageName: 'English' },
};

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[];
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function getLanguage(code: string): LanguageConfig {
  const language = LANGUAGES[code as LanguageCode];
  if (!language) throw new Error(`Unsupported language code: ${code}`);
  return language;
}

/** Device, as stored in Postgres (Prisma enum) and as DataForSEO expects it. */
export type DeviceCode = 'DESKTOP' | 'MOBILE';

export const DEVICES: { code: DeviceCode; label: string; dataForSeo: 'desktop' | 'mobile' }[] = [
  { code: 'DESKTOP', label: 'Desktop', dataForSeo: 'desktop' },
  { code: 'MOBILE', label: 'Mobile', dataForSeo: 'mobile' },
];

export const DEVICE_CODES = DEVICES.map((device) => device.code);

export const DEFAULT_DEVICE: DeviceCode = 'DESKTOP';

/** The devices a new project tracks unless the user says otherwise. */
export const DEFAULT_DEVICES: DeviceCode[] = ['DESKTOP'];

export function deviceLabel(device: string): string {
  return DEVICES.find((entry) => entry.code === device)?.label ?? device;
}

/**
 * The Google property used before per-country domains existed.
 *
 * Every keyword created up to that point was checked against google.com
 * whatever its country, so this is what those rows are backfilled with — the
 * alternative would be claiming a history came from a domain it never used.
 */
export const LEGACY_GOOGLE_DOMAIN = 'google.com';

export function toDataForSeoDevice(device: DeviceCode): 'desktop' | 'mobile' {
  return device === 'MOBILE' ? 'mobile' : 'desktop';
}

/** Result depths offered in the UI. DataForSEO allows up to 700. */
export const DEPTH_OPTIONS = [10, 20, 50, 100] as const;
export const DEFAULT_DEPTH = 100;
export const MAX_DEPTH = 700;

/* -------------------------------------------------------------------------
 * SERP outcome
 *
 * A ranking check has four possible outcomes, and they are not
 * interchangeable. In particular "we could not read the SERP" is not the same
 * fact as "the site does not rank": the first says nothing at all about the
 * website, the second is a measurement.
 * ---------------------------------------------------------------------- */

export const SERP_STATUSES = [
  /** A SERP was read and the tracked domain was found in it. */
  'RANKED',
  /** A SERP was read and the tracked domain was not in it. */
  'NOT_RANKED',
  /** The provider returned no SERP (e.g. 40102) after every retry. */
  'SERP_UNAVAILABLE',
  /** Auth, billing, network or request failure — the call never completed. */
  'API_ERROR',
] as const;

export type SerpStatus = (typeof SERP_STATUSES)[number];

/**
 * The statuses that carry an actual observation of the SERP.
 *
 * Only these may be read as a position: a row with any other status records an
 * attempt, not a measurement, and must never displace a real one.
 */
export const MEASURED_SERP_STATUSES: SerpStatus[] = ['RANKED', 'NOT_RANKED'];

export function isMeasuredSerpStatus(status: string | null | undefined): boolean {
  return status === 'RANKED' || status === 'NOT_RANKED';
}

export function serpStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'RANKED':
      return 'Ranked';
    case 'NOT_RANKED':
      return 'Not ranking';
    case 'SERP_UNAVAILABLE':
      return 'SERP unavailable';
    case 'API_ERROR':
      return 'Check failed';
    default:
      return 'Not checked';
  }
}

/**
 * Coerce a depth to something DataForSEO actually accepts.
 *
 * The provider reads `depth` in whole result pages: it rounds up to the next
 * multiple of 10 and rejects anything outside 10..700. Sending 55 quietly
 * becomes 60 and costs a page more than intended, so we round here instead and
 * the depth we log is the depth that was searched.
 */
export function normalizeDepth(depth: number): number {
  if (!Number.isFinite(depth)) return DEFAULT_DEPTH;
  const bounded = Math.min(Math.max(Math.trunc(depth), 10), MAX_DEPTH);
  return Math.ceil(bounded / 10) * 10;
}
