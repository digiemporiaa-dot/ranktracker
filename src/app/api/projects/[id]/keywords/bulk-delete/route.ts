import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import {
  ApiError,
  assertNoRunningCheck,
  parseBody,
  requireProject,
  requireUser,
  route,
} from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { bulkDeleteKeywordsSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

const DESTRUCTIVE_PER_WINDOW = 20;
const WINDOW_SECONDS = 60 * 10;

/**
 * Delete several keywords at once.
 *
 * The ids are never trusted on their own: the delete is scoped by projectId,
 * which is itself scoped to the signed-in user. Ids belonging to someone
 * else's project therefore match nothing and are silently skipped, rather
 * than erroring in a way that would confirm those ids exist.
 */
export async function POST(request: Request, { params }: Params) {
  return route('POST /api/projects/[id]/keywords/bulk-delete', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    const limit = rateLimit(
      `destructive:${user.id}`,
      DESTRUCTIVE_PER_WINDOW,
      WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw new ApiError(429, 'Too many changes at once. Please try again shortly.');
    }

    await assertNoRunningCheck(project.id);

    const { keywordIds } = await parseBody(request, bulkDeleteKeywordsSchema);

    const unique = Array.from(new Set(keywordIds));

    const { count } = await prisma.keyword.deleteMany({
      where: { id: { in: unique }, projectId: project.id },
    });

    logger.info('keywords bulk deleted', {
      requestId,
      userId: user.id,
      projectId: project.id,
      requested: unique.length,
      deleted: count,
    });

    // The caller compares `deleted` against what it sent, so a partial result
    // can be reported honestly rather than as a full success.
    return NextResponse.json({ deleted: count, requested: unique.length });
  });
}
