import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import {
  ApiError,
  assertNoRunningCheck,
  limitDestructive,
  parseBody,
  requireProject,
  requireUser,
  route,
} from '@/lib/api';
import { clearKeywordsSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

/**
 * Remove every keyword in a project, and its whole ranking history.
 *
 * This is the most destructive action short of deleting the account, so it
 * requires the project's name typed back exactly. Rankings cascade from the
 * keywords; the project's RankCheck rows go in the same transaction, since a
 * run that no longer has any keywords behind it renders as empty history.
 */
export async function DELETE(request: Request, { params }: Params) {
  return route('DELETE /api/projects/[id]/keywords/all', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

    limitDestructive(user.id);

    await assertNoRunningCheck(project.id);

    const { confirm } = await parseBody(request, clearKeywordsSchema);

    if (confirm !== project.name) {
      throw new ApiError(400, 'That does not match the project name. Nothing was deleted.');
    }

    const [keywords] = await prisma.$transaction([
      prisma.keyword.deleteMany({ where: { projectId: project.id } }),
      prisma.rankCheck.deleteMany({ where: { projectId: project.id } }),
    ]);

    logger.info('keywords cleared', {
      requestId,
      userId: user.id,
      projectId: project.id,
      deleted: keywords.count,
    });

    return NextResponse.json({ deleted: keywords.count });
  });
}
