/**
 * Single-keyword DataForSEO smoke test.
 *
 * Run this first, before checking a whole project:
 *
 *   npm run dataforseo:check -- --keyword "microsoft reseller india" \
 *     --domain wroffy.com --country IN --device DESKTOP --results 100
 *
 * It prints exactly what the application would store, plus the surrounding
 * organic results so you can eyeball that the position is right.
 */
import 'dotenv/config';

import { checkKeywordRanking, fetchSerp } from '../src/lib/dataforseo';
import { COUNTRIES, type CountryCode, type DeviceCode, type LanguageCode } from '../src/config/serp';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required argument --${name}`);
  }
  return value;
}

async function main() {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    console.error(
      'DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in .env before running this.',
    );
    process.exit(1);
  }

  const country = arg('country', 'IN') as CountryCode;

  if (!COUNTRIES[country]) {
    console.error(`Unsupported country "${country}". Supported: ${Object.keys(COUNTRIES).join(', ')}`);
    process.exit(1);
  }

  // The app resolves a city name to a location code from DataForSEO's own
  // list. This script has no picker, so --location takes the code directly —
  // handy for checking a city before wiring it into a project.
  const locationCode = Number(arg('location', String(COUNTRIES[country].locationCode)));

  const lookup = {
    keyword: arg('keyword'),
    domain: arg('domain'),
    country,
    city: null,
    locationCode,
    googleDomain: arg('google-domain', COUNTRIES[country].googleDomain),
    language: arg('language', 'en') as LanguageCode,
    device: arg('device', 'DESKTOP').toUpperCase() as DeviceCode,
    results: Number(arg('results', '100')),
  };

  console.log('Requesting SERP from DataForSEO');
  console.log(`  keyword:  ${lookup.keyword}`);
  console.log(`  domain:   ${lookup.domain}`);
  console.log(`  country:  ${COUNTRIES[lookup.country].label}`);
  console.log(`  location: location_code ${lookup.locationCode}`);
  console.log(`  google:   ${lookup.googleDomain}`);
  console.log(`  language: ${lookup.language}`);
  console.log(`  device:   ${lookup.device}`);
  console.log(`  results:  ${lookup.results}`);
  console.log();

  const startedAt = Date.now();
  const organic = await fetchSerp(lookup, 'dataforseo-check');
  const result = await checkKeywordRanking(lookup, organic, 'dataforseo-check');
  const durationMs = Date.now() - startedAt;

  console.log(`Received ${organic.length} organic results in ${durationMs} ms.`);
  console.log();
  console.log('Top 10 organic results:');
  for (const item of organic.slice(0, 10)) {
    console.log(`  #${String(item.position).padStart(3)}  ${item.url}`);
  }

  if (result.position !== null) {
    console.log();
    console.log('Target domain found:');
    console.log(`  position:   #${result.position}`);
    console.log(`  rankingUrl: ${result.rankingUrl}`);
    // Show what surrounds the hit, so an off-by-one would be obvious.
    const around = organic.filter(
      (item) => Math.abs(item.position - result.position!) <= 2,
    );
    console.log();
    console.log('Context:');
    for (const item of around) {
      const marker = item.position === result.position ? '>>' : '  ';
      console.log(`  ${marker} #${String(item.position).padStart(3)}  ${item.url}`);
    }
  } else {
    console.log();
    console.log(`Target domain not found in the first ${organic.length} organic results.`);
    console.log('The application would store position = null and display "Not Found".');
  }
}

main().catch((error) => {
  console.error('DataForSEO check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
