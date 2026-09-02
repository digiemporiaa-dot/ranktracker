import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { requireProject, requireUser, route } from '@/lib/api';
import { getKeywordRows, summarize } from '@/lib/queries';

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

export async function DELETE(_request: Request, { params }: Params) {
  return route('DELETE /api/projects/[id]', async () => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    await prisma.project.delete({ where: { id: project.id } });
    return NextResponse.json({ ok: true });
  });
}
