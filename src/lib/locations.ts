import 'server-only';

import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ApiError } from '@/lib/api';
import {
  DataForSeoError,
  DataForSeoNotConfiguredError,
  fetchLocationList,
  type ProviderLocation,
} from '@/lib/dataforseo';
import { getCountry, type CountryCode } from '@/config/serp';

/**
 * Turning "India" and optionally "New Delhi" into the location DataForSEO
 * expects.
 *
 * Nobody using this app should ever have to know that DataForSEO identifies
 * places by number. The browser sends a country code and, if the user chose
 * one, a city name; the id is looked up here, on the server, from the
 * provider's own list. A location id in a request body is ignored — there is
 * no field for one.
 */

/** A city offered in the city picker. */
export type CityOption = {
  /** What the user sees and what we store, e.g. "New Delhi,Delhi". */
  label: string;
  /** DataForSEO's own name for it, kept for support and debugging. */
  providerName: string;
  locationCode: number;
};

export type ResolvedLocation = {
  country: CountryCode;
  /** Null for a country-level search. */
  city: string | null;
  locationCode: number;
  googleDomain: string;
  /** A short human description, e.g. "New Delhi, Delhi · India". */
  label: string;
};

/** Cities are a reference list; a week between refreshes is plenty. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bumped when the shape below changes, so old rows are ignored rather than read. */
const CACHE_VERSION = 'v1';

const cacheKeyFor = (country: CountryCode) => `locations:${CACHE_VERSION}:google:${country}`;

/**
 * DataForSEO names a city by its whole path, e.g. "New Delhi,Delhi,India".
 * The country is already known from the picker, so it is dropped and the rest
 * kept — "Delhi" is what tells two same-named cities apart.
 */
function toLabel(providerName: string, countryLabel: string): string {
  const parts = providerName.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === countryLabel.toLowerCase()) {
    parts.pop();
  }
  return parts.join(',');
}

function toCityOptions(rows: ProviderLocation[], country: CountryCode): CityOption[] {
  const countryConfig = getCountry(country);

  const cities = rows
    .filter(
      (row) =>
        row.location_type === 'City' &&
        typeof row.location_name === 'string' &&
        // A positive integer, specifically. Number(null) is 0, which is finite
        // but is not a location — a row like that would otherwise be offered
        // in the picker and then searched as location 0.
        Number.isInteger(Number(row.location_code)) &&
        Number(row.location_code) > 0 &&
        // The per-country endpoint is already scoped, but the whole-list
        // fallback is not, so this filter has to hold either way.
        (!row.country_iso_code || row.country_iso_code.toUpperCase() === country),
    )
    .map((row) => ({
      label: toLabel(row.location_name, countryConfig.label),
      providerName: row.location_name,
      locationCode: Number(row.location_code),
    }))
    .filter((city) => city.label.length > 0);

  // Two rows sharing a label would make the picker ambiguous; keep the first.
  const seen = new Set<string>();
  const unique = cities.filter((city) => {
    const key = city.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => a.label.localeCompare(b.label));
}

async function readCache(country: CountryCode): Promise<CityOption[] | null> {
  try {
    const hit = await prisma.serpCache.findUnique({ where: { cacheKey: cacheKeyFor(country) } });
    if (hit && hit.expiresAt > new Date()) return hit.payload as unknown as CityOption[];
  } catch (error) {
    // A cache miss is not a failure — the provider is asked instead.
    logger.warn('location cache read failed', { country, error });
  }
  return null;
}

async function writeCache(country: CountryCode, cities: CityOption[]): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
  try {
    await prisma.serpCache.upsert({
      where: { cacheKey: cacheKeyFor(country) },
      create: { cacheKey: cacheKeyFor(country), payload: cities as unknown as object, expiresAt },
      update: { payload: cities as unknown as object, expiresAt },
    });
  } catch (error) {
    logger.warn('location cache write failed', { country, error });
  }
}

/**
 * Every city DataForSEO knows for a country.
 *
 * The country-scoped path is tried first because the unscoped list covers the
 * whole world. If the provider does not serve that path, the full list is
 * fetched and filtered instead — the answer is the same either way, so a
 * missing route is a performance problem rather than a broken feature.
 */
export async function listCities(
  country: CountryCode,
  requestId = 'locations',
): Promise<CityOption[]> {
  const cached = await readCache(country);
  if (cached) return cached;

  let rows: ProviderLocation[];
  try {
    rows = await fetchLocationList(country, requestId);
  } catch (error) {
    if (error instanceof DataForSeoNotConfiguredError) throw error;

    logger.warn('per-country location list unavailable, falling back to the full list', {
      requestId,
      country,
      error,
    });
    rows = await fetchLocationList(undefined, requestId);
  }

  const cities = toCityOptions(rows, country);

  logger.info('city list loaded', { requestId, country, cities: cities.length });

  if (cities.length > 0) await writeCache(country, cities);

  return cities;
}

/** A location that has already been resolved once and stored. */
export type KnownLocation = {
  country: string;
  city: string | null;
  locationCode: number;
};

/**
 * Resolve what the user chose into the location a rank check will use.
 *
 * A country on its own is resolved from local config and never touches the
 * network, so country-level tracking keeps working even when the provider is
 * unreachable or not configured yet. Only a city needs the provider.
 *
 * `known` is the location already stored on the record being updated. When the
 * choice has not actually changed, its id is reused and the provider is not
 * called at all — otherwise renaming a city-level project would fail whenever
 * the provider happened to be down, for an edit that touches no location.
 */
export async function resolveLocation(
  input: { country: CountryCode; city?: string | null },
  requestId = 'locations',
  known?: KnownLocation,
): Promise<ResolvedLocation> {
  const country = getCountry(input.country);
  const city = input.city?.trim() ?? '';

  if (!city) {
    return {
      country: country.code,
      city: null,
      locationCode: country.locationCode,
      googleDomain: country.googleDomain,
      label: country.label,
    };
  }

  // The same country and the same city as last time: the id cannot have
  // changed, so there is nothing to look up. The Google domain is still taken
  // from config rather than from the stored row, so a project saved before
  // per-country domains existed picks the right one up on its next edit.
  if (
    known &&
    known.country === country.code &&
    known.city !== null &&
    known.city.toLowerCase() === city.toLowerCase()
  ) {
    return {
      country: country.code,
      city: known.city,
      locationCode: known.locationCode,
      googleDomain: country.googleDomain,
      label: `${known.city} · ${country.label}`,
    };
  }

  let cities: CityOption[];
  try {
    cities = await listCities(country.code, requestId);
  } catch (error) {
    if (error instanceof DataForSeoNotConfiguredError) {
      throw new ApiError(
        503,
        'Cities are unavailable until the SERP provider is configured. You can track this project at country level in the meantime.',
      );
    }
    if (error instanceof DataForSeoError) {
      throw new ApiError(
        502,
        'We could not load the list of cities just now. Please try again, or track this project at country level.',
      );
    }
    throw error;
  }

  const needle = city.toLowerCase();
  const match =
    cities.find((option) => option.label.toLowerCase() === needle) ??
    cities.find((option) => option.providerName.toLowerCase() === needle) ??
    // A city typed without its region still resolves, as long as it is the
    // only one with that name. An ambiguous "Springfield" is refused rather
    // than guessed at.
    (() => {
      const leaf = cities.filter(
        (option) => option.label.split(',')[0].trim().toLowerCase() === needle,
      );
      return leaf.length === 1 ? leaf[0] : undefined;
    })();

  if (!match) {
    throw new ApiError(
      400,
      `We could not find "${city}" in ${country.label}. Pick a city from the list, or leave it empty to track the whole country.`,
    );
  }

  return {
    country: country.code,
    city: match.label,
    locationCode: match.locationCode,
    googleDomain: country.googleDomain,
    label: `${match.label} · ${country.label}`,
  };
}
