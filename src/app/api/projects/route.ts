import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { ApiError, parseBody, requireUser, route } from '@/lib/api';
import { projectScope } from '@/lib/scope';
import { createProjectSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

const MAX_PROJECTS_PER_USER = 100;

export async function GET() {
  return route('GET /api/projects', async () => {
    const user = await requireUser();

    const projects = await prisma.project.findMany({
      where: projectScope(user),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        domain: true,
        country: true,
        language: true,
        device: true,
        isDemo: true,
        createdAt: true,
        _count: { select: { keywords: true } },
      },
    });

    return NextResponse.json({ projects });
  });
}

export async function POST(request: Request) {
  return route('POST /api/projects', async ({ requestId }) => {
    const user = await requireUser();
    const input = await parseBody(request, createProjectSchema);

    // Deliberately not scoped: the cap is per owner, so a superadmin is
    // limited by their own project count, not by everyone's.
    const count = await prisma.project.count({ where: { userId: user.id } });
    if (count >= MAX_PROJECTS_PER_USER) {
      throw new ApiError(400, `You can create at most ${MAX_PROJECTS_PER_USER} projects.`);
    }

    // Also deliberately not scoped: Project (userId, name) is unique per owner,
    // so a superadmin may reuse a name an executive already has.
    const duplicate = await prisma.project.findFirst({
      where: { userId: user.id, name: input.name },
    });
    if (duplicate) {
      throw new ApiError(409, 'You already have a project with that name.');
    }

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: input.name,
        domain: input.domain,
        country: input.country,
        language: input.language,
        device: input.device,
      },
    });

    logger.info('project created', { requestId, userId: user.id, projectId: project.id });

    return NextResponse.json({ project }, { status: 201 });
  });
}
