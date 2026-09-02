/**
 * Minimal structured logger.
 *
 * Secrets are stripped defensively: even if a caller accidentally passes a
 * credential-bearing object, the redaction pass below removes it before the
 * line is ever written.
 */

const REDACTED = '[redacted]';

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|auth|credential|cookie|apikey|api_key|dataforseo_login|database_url|session_secret)/i;

const secretValues = (): string[] =>
  [
    process.env.DATAFORSEO_PASSWORD,
    process.env.DATAFORSEO_LOGIN,
    process.env.SESSION_SECRET,
    process.env.DATABASE_URL,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

function scrubString(value: string): string {
  let out = value;
  for (const secret of secretValues()) {
    if (secret.length >= 4 && out.includes(secret)) {
      out = out.split(secret).join(REDACTED);
    }
  }
  // Strip any Basic/Bearer credential that made it into a message.
  return out.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, `$1 ${REDACTED}`);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return '[unserializable]';
}

export type LogContext = {
  requestId?: string;
  userId?: string;
  projectId?: string;
  keywordId?: string;
  rankCheckId?: string;
  status?: string | number;
  durationMs?: number;
  error?: unknown;
  [key: string]: unknown;
};

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, context: LogContext = {}) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message: scrubString(message),
    ...(redact(context) as Record<string, unknown>),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (message: string, context?: LogContext) => {
    if (process.env.NODE_ENV === 'development') emit('debug', message, context);
  },
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};

/** Correlation id for a single inbound request or background job. */
export function newRequestId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const __testing = { redact, scrubString };
