import { z } from 'zod';

/**
 * Server-only environment configuration.
 *
 * Importing this module from a Client Component is a build error by design —
 * DataForSEO credentials and the session secret must never reach the browser.
 */
import 'server-only';

const intFromEnv = (fallback: number, min: number, max: number) =>
  z
    .union([z.string(), z.number(), z.undefined()])
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  DATAFORSEO_LOGIN: z.string().default(''),
  DATAFORSEO_PASSWORD: z.string().default(''),
  SERP_CONCURRENCY: intFromEnv(3, 1, 20),
  MAX_KEYWORDS_PER_CHECK: intFromEnv(500, 1, 5000),
  SERP_RESULTS: intFromEnv(100, 10, 700),
  SERP_CACHE_MINUTES: intFromEnv(30, 0, 1440),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

function load() {
  const parsed = schema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN,
    DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD,
    SERP_CONCURRENCY: process.env.SERP_CONCURRENCY,
    MAX_KEYWORDS_PER_CHECK: process.env.MAX_KEYWORDS_PER_CHECK,
    SERP_RESULTS: process.env.SERP_RESULTS,
    SERP_CACHE_MINUTES: process.env.SERP_CACHE_MINUTES,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    // Only the offending *keys* are printed — never the values.
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Invalid server environment configuration. Check these variables: ${keys}. See .env.example.`,
    );
  }
  return parsed.data;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';

/** True when DataForSEO credentials are configured. */
export function hasDataForSeoCredentials(): boolean {
  return env.DATAFORSEO_LOGIN.length > 0 && env.DATAFORSEO_PASSWORD.length > 0;
}
