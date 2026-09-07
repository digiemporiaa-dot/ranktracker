import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
  ApiError,
  assertNoRunningCheck,
  limitDestructive,
  limitProjectEdit,
  parseBody,
  requireProject,
  requireUser,
  route,
} from '@/lib/api';
import { updateProjectSchema } from '@/lib/validation';
import { getKeywordRows, summarize } from '@/lib/queries';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return route('GET /api/projects/[id]', async () => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    const rows = await getKeywordRows(project.id);
    const { stats, lastCheckedAt } = summarize(rows);

    const latestCheck = await prisma.rankCheck.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ project, stats, lastCheckedAt, latestCheck });
  });
}

/**
 * Edit a project.
 *
 * Changing `domain` is allowed but guarded. Every Ranking row records a
 * position *for a particular domain*, so after a change the stored history
 * describes two different websites. The caller must acknowledge that with
 * `confirmDomainChange`; the check lives here and not only in the dialog, so
 * skipping the UI cannot skip the warning.
 *
 * Changing country / language / device only changes the defaults applied to
 * keywords added afterwards. Existing Keyword rows keep their own values,
 * because (projectId, keyword, country, language, device) is the keyword's
 * identity. `searchDomain` is project-wide and applies to every check.
 */
export async function PATCH(request: Request, { params }: Params) {
  return route('PATCH /api/projects/[id]', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    limitProjectEdit(user.id);

    const input = await parseBody(request, updateProjectSchema);

    // Only a *real* change of website needs the acknowledgement — re-sending
    // the domain the project already has is not a change.
    const domainChanged = input.domain !== undefined && input.domain !== project.domain;
    if (domainChanged && input.confirmDomainChange !== true) {
      throw new ApiError(
        400,
        'Changing the website makes this project\u2019s existing ranking history describe a different site. Please confirm the change first.',
      );
    }

    try {
      const updated = await prisma.project.update({
        where: { id: project.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(domainChanged ? { domain: input.domain } : {}),
          ...(input.country !== undefined ? { country: input.country } : {}),
          ...(input.language !== undefined ? { language: input.language } : {}),
          ...(input.device !== undefined ? { device: input.device } : {}),
          ...(input.searchDomain !== undefined ? { searchDomain: input.searchDomain } : {}),
        },
      });

      logger.info('project updated', {
        requestId,
        userId: user.id,
        projectId: project.id,
        fields: Object.keys(input),
        domainChanged,
      });

      return NextResponse.json({ project: updated });
    } catch (error) {
      // Project (userId, name) is unique. Translate the constraint violation
      // rather than letting a raw Prisma error reach the client.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApiError(409, 'You already have a project with that name.');
      }
      throw error;
    }
  });
}

/**
 * Delete a project, along with its keywords, rankings and ranking checks.
 *
 * The children go via `onDelete: Cascade` in the schema, so there is no
 * ordering problem to manage here.
 */
export async function DELETE(_request: Request, { params }: Params) {
  return route('DELETE /api/projects/[id]', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    limitDestructive(user.id);

    await assertNoRunningCheck(project.id);

    await prisma.project.delete({ where: { id: project.id } });

    logger.info('project deleted', { requestId, userId: user.id, projectId: project.id });

    return NextResponse.json({ ok: true });
  });
}
