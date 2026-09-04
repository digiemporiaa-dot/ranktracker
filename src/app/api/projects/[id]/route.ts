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
import { resolveLocation } from '@/lib/locations';
import type { CountryCode } from '@/config/serp';
import { getKeywordRows, summarize } from '@/lib/queries';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return route('GET /api/projects/[id]', async () => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

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
 * `domain` is not editable. Every Ranking row records a position *for a
 * particular domain*, so changing it would leave one project's history
 * describing two different websites. A different domain means a new project.
 *
 * Changing the location, language or devices only changes the defaults applied
 * to keywords added afterwards. Existing Keyword rows keep their own values,
 * because (projectId, keyword, locationCode, language, device) is the
 * keyword's identity — rewriting them would silently re-label history that was
 * measured somewhere else.
 */
export async function PATCH(request: Request, { params }: Params) {
  return route('PATCH /api/projects/[id]', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

    limitProjectEdit(user.id);

    const input = await parseBody(request, updateProjectSchema);

    // Country and city are resolved together: a city only means anything
    // inside a country. Moving the project to a different country without
    // naming a new city drops back to country-level rather than carrying a
    // city that does not exist there.
    const locationChanged = input.country !== undefined || input.city !== undefined;

    const location = locationChanged
      ? await resolveLocation(
          {
            country: input.country ?? (project.country as CountryCode),
            city:
              input.city !== undefined
                ? input.city
                : input.country !== undefined
                  ? null
                  : project.city,
          },
          requestId,
          // What the project already resolved to. An edit that leaves the
          // location alone reuses it instead of asking the provider again.
          { country: project.country, city: project.city, locationCode: project.locationCode },
        )
      : null;

    try {
      const updated = await prisma.project.update({
        where: { id: project.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(location
            ? {
                country: location.country,
                city: location.city,
                locationCode: location.locationCode,
                googleDomain: location.googleDomain,
              }
            : {}),
          ...(input.language !== undefined ? { language: input.language } : {}),
          ...(input.devices !== undefined ? { devices: input.devices } : {}),
        },
      });

      logger.info('project updated', {
        requestId,
        userId: user.id,
        projectId: project.id,
        fields: Object.keys(input),
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
    const project = await requireProject(user, id);

    limitDestructive(user.id);

    await assertNoRunningCheck(project.id);

    await prisma.project.delete({ where: { id: project.id } });

    logger.info('project deleted', { requestId, userId: user.id, projectId: project.id });

    return NextResponse.json({ ok: true });
  });
}
