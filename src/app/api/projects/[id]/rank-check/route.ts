import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { ApiError, parseBody, requireProject, requireUser, route } from '@/lib/api';
import { rankCheckSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/rate-limit';
import { env, hasDataForSeoCredentials } from '@/lib/env';
import { startRankCheck } from '@/lib/rank-check';

type Params = { params: Promise<{ id: string }> };

/** Ranking checks cost provider credits, so they are rate limited per user. */
const CHECKS_PER_WINDOW = 10;
const WINDOW_SECONDS = 60 * 10;

export async function POST(request: Request, { params }: Params) {
  return route('POST /api/projects/[id]/rank-check', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    // Fail loudly rather than returning invented ranking data.
    if (!hasDataForSeoCredentials()) {
      throw new ApiError(
        503,
        'Ranking checks are not available because the SERP provider is not configured. Add DataForSEO credentials to the server environment.',
      );
    }

    const limit = rateLimit(`rank-check:${user.id}`, CHECKS_PER_WINDOW, WINDOW_SECONDS);
    if (!limit.allowed) {
      throw new ApiError(
        429,
        `You have run too many ranking checks. Please try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      );
    }

    const input = await parseBody(request, rankCheckSchema);

    // One run at a time per project, so progress stays meaningful.
    const running = await prisma.rankCheck.findFirst({
      where: { projectId: project.id, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (running) {
      return NextResponse.json(
        { rankCheckId: running.id, alreadyRunning: true },
        { status: 200 },
      );
    }

    const keywords = await prisma.keyword.findMany({
      where: {
        projectId: project.id,
        active: true,
        ...(input.keywordIds?.length ? { id: { in: input.keywordIds } } : {}),
      },
      select: {
        id: true,
        keyword: true,
        targetUrl: true,
        country: true,
        language: true,
        device: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (keywords.length === 0) {
      throw new ApiError(400, 'This project has no active keywords to check.');
    }

    if (keywords.length > env.MAX_KEYWORDS_PER_CHECK) {
      throw new ApiError(
        400,
        `A single check can cover at most ${env.MAX_KEYWORDS_PER_CHECK} keywords. This project has ${keywords.length}.`,
      );
    }

    const depth = input.depth ?? env.SERP_RESULTS;

    const rankCheckId = await startRankCheck({
      project: { id: project.id, domain: project.domain, userId: project.userId },
      keywords,
      depth,
      requestId,
    });

    return NextResponse.json(
      { rankCheckId, totalKeywords: keywords.length, depth },
      { status: 202 },
    );
  });
}

export async function GET(_request: Request, { params }: Params) {
  return route('GET /api/projects/[id]/rank-check', async () => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    const checks = await prisma.rankCheck.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({ checks });
  });
}
