import { NextResponse } from 'next/server';

import { requireRankCheck, requireUser, route } from '@/lib/api';

type Params = { params: Promise<{ id: string }> };

/** Progress endpoint the dashboard polls while a check runs. */
export async function GET(_request: Request, { params }: Params) {
  return route('GET /api/rank-check/[id]', async () => {
    const user = await requireUser();
    const { id } = await params;
    const rankCheck = await requireRankCheck(user.id, id);

    const total = rankCheck.totalKeywords || 0;
    const done = rankCheck.completedKeywords + rankCheck.failedKeywords;

    return NextResponse.json({
      id: rankCheck.id,
      projectId: rankCheck.projectId,
      status: rankCheck.status,
      totalKeywords: total,
      completedKeywords: rankCheck.completedKeywords,
      failedKeywords: rankCheck.failedKeywords,
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
      message: rankCheck.message,
      startedAt: rankCheck.startedAt,
      completedAt: rankCheck.completedAt,
    });
  });
}
