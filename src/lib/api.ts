import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getCurrentUser, type SessionUser } from '@/lib/auth';
import { logger, newRequestId } from '@/lib/logger';
import { DataForSeoError } from '@/lib/dataforseo';

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
 * Load a project the user actually owns.
 *
 * Ownership is enforced in the query itself, so one user can never read or
 * write another user's project — a wrong id is indistinguishable from a
 * project that does not exist.
 */
export async function requireProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
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

export async function requireRankCheck(userId: string, rankCheckId: string) {
  const rankCheck = await prisma.rankCheck.findFirst({
    where: { id: rankCheckId, project: { userId } },
    include: { project: { select: { id: true, name: true, domain: true } } },
  });
  if (!rankCheck) throw notFound('ranking check');
  return rankCheck;
}

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
