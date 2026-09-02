import 'server-only';

/**
 * In-process fixed-window rate limiter.
 *
 * Adequate for a single application instance, which is what the Coolify /
 * docker-compose deployment runs. Behind multiple replicas this limits per
 * replica — see "Known limitations" in the README.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Keep the map from growing without bound.
const MAX_BUCKETS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  if (buckets.size > MAX_BUCKETS) {
    for (const [k, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(k);
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Test helper. */
export function __resetRateLimits() {
  buckets.clear();
}
