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
  /** DataForSEO `location_code`. */
  locationCode: number;
  /** DataForSEO `location_name`, sent alongside for traceability in logs. */
  locationName: string;
};

export const COUNTRIES: Record<CountryCode, CountryConfig> = {
  IN: { code: 'IN', label: 'India', locationCode: 2356, locationName: 'India' },
  US: { code: 'US', label: 'United States', locationCode: 2840, locationName: 'United States' },
  GB: { code: 'GB', label: 'United Kingdom', locationCode: 2826, locationName: 'United Kingdom' },
  CA: { code: 'CA', label: 'Canada', locationCode: 2124, locationName: 'Canada' },
  AU: { code: 'AU', label: 'Australia', locationCode: 2036, locationName: 'Australia' },
  AE: { code: 'AE', label: 'United Arab Emirates', locationCode: 2784, locationName: 'United Arab Emirates' },
  SG: { code: 'SG', label: 'Singapore', locationCode: 2702, locationName: 'Singapore' },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];
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

export const DEFAULT_DEVICE: DeviceCode = 'DESKTOP';

export function toDataForSeoDevice(device: DeviceCode): 'desktop' | 'mobile' {
  return device === 'MOBILE' ? 'mobile' : 'desktop';
}

/** Result depths offered in the UI. DataForSEO allows up to 700. */
export const DEPTH_OPTIONS = [10, 20, 50, 100] as const;
export const DEFAULT_DEPTH = 100;
export const MAX_DEPTH = 700;
