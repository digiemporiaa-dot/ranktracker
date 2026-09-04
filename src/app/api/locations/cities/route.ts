import { NextResponse } from 'next/server';

import { ApiError, requireUser, route } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { cityQuerySchema } from '@/lib/validation';
import { listCities } from '@/lib/locations';
import { DataForSeoError, DataForSeoNotConfiguredError } from '@/lib/dataforseo';

/**
 * The cities offered in the city picker.
 *
 * Reference data, not anyone's data: any signed-in user may read it, and there
 * is nothing here to scope to a project. What it deliberately does not do is
 * accept a location id — ids only ever travel from the provider to us.
 */

/** How many options one response carries. The picker is a search box. */
const MAX_RESULTS = 50;

/** Generous, but a miss costs a provider call, so not unlimited. */
const LOOKUPS_PER_WINDOW = 60;
const WINDOW_SECONDS = 60;

export async function GET(request: Request) {
  return route('GET /api/locations/cities', async ({ requestId }) => {
    const user = await requireUser();

    const url = new URL(request.url);
    const parsed = cityQuerySchema.safeParse({
      country: url.searchParams.get('country') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });

    if (!parsed.success) {
      throw new ApiError(400, 'Choose a country first.');
    }

    const limit = rateLimit(`city-lookup:${user.id}`, LOOKUPS_PER_WINDOW, WINDOW_SECONDS);
    if (!limit.allowed) {
      throw new ApiError(429, 'Too many searches at once. Please try again shortly.');
    }

    let cities;
    try {
      cities = await listCities(parsed.data.country, requestId);
    } catch (error) {
      // The picker is optional: country-level tracking still works, so this
      // says so plainly instead of failing the whole page.
      if (error instanceof DataForSeoNotConfiguredError) {
        return NextResponse.json(
          {
            cities: [],
            total: 0,
            unavailable:
              'City search needs the SERP provider to be configured. You can still track the whole country.',
          },
          { status: 200 },
        );
      }
      if (error instanceof DataForSeoError) {
        return NextResponse.json(
          {
            cities: [],
            total: 0,
            unavailable:
              'We could not load the city list just now. You can still track the whole country.',
          },
          { status: 200 },
        );
      }
      throw error;
    }

    const search = parsed.data.search?.toLowerCase() ?? '';
    const matches = search
      ? cities.filter((city) => city.label.toLowerCase().includes(search))
      : cities;

    // Names that begin with what was typed are the ones being looked for.
    const ranked = search
      ? [...matches].sort((a, b) => {
          const aStarts = a.label.toLowerCase().startsWith(search) ? 0 : 1;
          const bStarts = b.label.toLowerCase().startsWith(search) ? 0 : 1;
          return aStarts - bStarts || a.label.localeCompare(b.label);
        })
      : matches;

    return NextResponse.json({
      // Only the display name travels to the browser. The id it maps to is
      // looked up again on the server when the project is saved.
      cities: ranked.slice(0, MAX_RESULTS).map((city) => ({ label: city.label })),
      total: matches.length,
      truncated: matches.length > MAX_RESULTS,
    });
  });
}
