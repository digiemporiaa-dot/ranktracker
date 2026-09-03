import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getCurrentUser, isSuperadmin, type SessionUser } from '@/lib/auth';
import { projectScope, viaProjectScope, type ScopedUser } from '@/lib/scope';
import { logger, newRequestId } from '@/lib/logger';
import { DataForSeoError } from '@/lib/dataforseo';
import { rateLimit } from '@/lib/rate-limit';
import { idParamSchema } from '@/lib/validation';

/** An error whose message is safe to show the user. */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export const unauthorized = () => new ApiError(401, 'Please sign in to continue.');
export const forbidden = () => new ApiError(403, 'You do not have access to this resource.');
export const notFound = (what = 'resource') =>
  new ApiError(404, `That ${what} could not be found.`);

export function jsonError(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

/**
 * Require a signed-in user, or throw.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

/**
 * Require a signed-in superadmin.
 *
 * A signed-out caller gets 401, as everywhere else. An authenticated
 * executive gets 404 rather than 403: the admin surface should not be
 * discoverable, and a 403 would confirm the route exists.
 */
export async function requireSuperadmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isSuperadmin(user)) throw notFound('page');
  return user;
}

/**
 * Load a project this user is allowed to work on.
 *
 * Access is enforced in the query itself, so one executive can never read or
 * write another's project — a project they do not own matches zero rows and is
 * indistinguishable from one that does not exist. A superadmin is scoped to
 * everything.
 *
 * This is one of only two places project access is decided; every
 * project-scoped route reaches the database through here.
 */
export async function requireProject(user: ScopedUser, projectId: string) {
  // The route param is validated here rather than in each route: an id that
  // is not even id-shaped cannot match a row, so it is answered like any
  // other unknown id instead of reaching the database.
  const id = idParamSchema.safeParse(projectId);
  if (!id.success) throw notFound('project');

  const project = await prisma.project.findFirst({
    where: { id: id.data, ...projectScope(user) },
  });
  if (!project) throw notFound('project');
  return project;
}

/**
 * Refuse a destructive change while a ranking check is in flight.
 *
 * The runner writes Ranking rows for this project from a background task; if
 * the keywords or the project disappear underneath it, those writes fail and
 * the run is left half-finished. PENDING counts too — such a check has been
 * created and is about to start writing, which is how the rank-check route
 * itself treats the two states.
 */
export async function assertNoRunningCheck(projectId: string): Promise<void> {
  const running = await prisma.rankCheck.findFirst({
    where: { projectId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  });

  if (running) {
    throw new ApiError(
      409,
      'A ranking check is running for this project. Wait for it to finish, then try again.',
    );
  }
}

/**
 * Load a ranking check this user is allowed to see.
 *
 * The second of the two access chokepoints: a RankCheck has no userId of its
 * own, so it is scoped through the project it belongs to.
 */
export async function requireRankCheck(user: ScopedUser, rankCheckId: string) {
  const id = idParamSchema.safeParse(rankCheckId);
  if (!id.success) throw notFound('ranking check');

  const rankCheck = await prisma.rankCheck.findFirst({
    where: { id: id.data, ...viaProjectScope(user) },
    include: { project: { select: { id: true, name: true, domain: true } } },
  });
  if (!rankCheck) throw notFound('ranking check');
  return rankCheck;
}

/**
 * Rate limits for the mutating project routes.
 *
 * All of them are per user and per fixed window. The buckets are separate so
 * that ordinary tidying up — deleting keywords one row at a time — cannot use
 * up the allowance that protects the rarely-used, wholesale deletes.
 */
const WINDOW_SECONDS = 60 * 10;

/** Whole-project or whole-list deletes. Rare by nature. */
const DESTRUCTIVE_PER_WINDOW = 20;
/** Editing a project's name or search settings. */
const EDITS_PER_WINDOW = 60;
/** Removing keywords one at a time from the table. */
const KEYWORD_DELETES_PER_WINDOW = 120;

function enforceRateLimit(key: string, limit: number): void {
  const result = rateLimit(key, limit, WINDOW_SECONDS);
  if (!result.allowed) {
    throw new ApiError(429, 'Too many changes at once. Please try again shortly.');
  }
}

/** Deleting a project, clearing its keywords, or a bulk delete. */
export const limitDestructive = (userId: string) =>
  enforceRateLimit(`destructive:${userId}`, DESTRUCTIVE_PER_WINDOW);

/** Editing a project. */
export const limitProjectEdit = (userId: string) =>
  enforceRateLimit(`project-edit:${userId}`, EDITS_PER_WINDOW);

/** Deleting a single keyword. */
export const limitKeywordDelete = (userId: string) =>
  enforceRateLimit(`keyword-delete:${userId}`, KEYWORD_DELETES_PER_WINDOW);

/** Parse a JSON request body against a schema, mapping failures to a 400. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, 'The request body could not be read.');
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const firstMessage =
      Object.values(fieldErrors).flat().find(Boolean) ?? 'Some fields are invalid.';
    throw new ApiError(400, String(firstMessage), fieldErrors);
  }
  return parsed.data;
}

/**
 * Wrap a route handler: assigns a request id, logs the outcome, and converts
 * any thrown error into a safe response. Raw provider, database and runtime
 * errors are logged server-side and never returned to the browser.
 */
export function route(
  name: string,
  handler: (context: { requestId: string }) => Promise<Response>,
): Promise<Response> {
  const requestId = newRequestId();
  const startedAt = Date.now();

  return handler({ requestId })
    .then((response) => {
      logger.info('request completed', {
        requestId,
        route: name,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return response;
    })
    .catch((error) => {
      const durationMs = Date.now() - startedAt;

      if (error instanceof ApiError) {
        logger.warn('request rejected', {
          requestId,
          route: name,
          status: error.status,
          durationMs,
          reason: error.message,
        });
        return jsonError(error.status, error.message, error.details);
      }

      if (error instanceof DataForSeoError) {
        logger.error('serp provider error', { requestId, route: name, durationMs, error });
        return jsonError(502, error.userMessage);
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        logger.error('database error', {
          requestId,
          route: name,
          durationMs,
          code: error.code,
          error,
        });
        if (error.code === 'P2002') {
          return jsonError(409, 'That already exists. Please use a different value.');
        }
        return jsonError(500, 'Something went wrong. Please try again.');
      }

      logger.error('unhandled route error', { requestId, route: name, durationMs, error });
      return jsonError(500, 'Something went wrong. Please try again.');
    });
}

/** Best-effort client identifier for rate limiting. */
export function clientKey(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}
