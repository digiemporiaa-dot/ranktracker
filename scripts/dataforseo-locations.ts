/**
 * Verify the location codes in src/config/serp.ts against DataForSEO.
 *
 *   npm run dataforseo:locations
 *
 * Fetches GET /v3/serp/google/locations and asserts that every configured
 * country code matches the country-level location DataForSEO reports. Run this
 * whenever you add a country, rather than trusting a hardcoded number.
 */
import 'dotenv/config';

import { fetchCountryLocations } from '../src/lib/dataforseo';
import { COUNTRIES, COUNTRY_CODES } from '../src/config/serp';

async function main() {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    console.error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in .env.');
    process.exit(1);
  }

  console.log('Fetching the DataForSEO location list…');
  const locations = await fetchCountryLocations();
  console.log(`Received ${locations.length} locations.`);
  console.log();

  const byCode = new Map(locations.map((location) => [location.location_code, location]));

  let failures = 0;

  for (const code of COUNTRY_CODES) {
    const configured = COUNTRIES[code];
    const reported = byCode.get(configured.locationCode);

    if (!reported) {
      console.log(`FAIL  ${configured.label}: location_code ${configured.locationCode} is not in the list`);
      failures += 1;
      continue;
    }

    const nameMatches =
      reported.location_name.toLowerCase() === configured.locationName.toLowerCase();
    const isCountry = !reported.location_type || reported.location_type === 'Country';

    if (nameMatches && isCountry) {
      console.log(`OK    ${configured.label.padEnd(22)} location_code ${configured.locationCode}`);
    } else {
      console.log(
        `FAIL  ${configured.label.padEnd(22)} location_code ${configured.locationCode} is "${reported.location_name}" (${reported.location_type ?? 'unknown type'})`,
      );
      failures += 1;
    }
  }

  console.log();
  if (failures > 0) {
    console.error(`${failures} location code(s) do not match. Update src/config/serp.ts.`);
    process.exit(1);
  }
  console.log('All configured location codes match DataForSEO.');
}

main().catch((error) => {
  console.error('Location check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
