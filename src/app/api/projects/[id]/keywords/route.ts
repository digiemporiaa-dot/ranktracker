import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import {
  ApiError,
  assertNoRunningCheck,
  limitKeywordDelete,
  parseBody,
  requireProject,
  requireUser,
  route,
} from '@/lib/api';
import {
  addKeywordsSchema,
  deleteKeywordQuerySchema,
  listQuerySchema,
} from '@/lib/validation';
import { parseKeywordList, MAX_KEYWORDS_PER_IMPORT } from '@/lib/csv';
import { normalizeTargetUrl } from '@/lib/domain';
import { buildKeywordRows, resolveKeywordTarget } from '@/lib/keywords';
import { applyFilters, decorate, getKeywordRows, paginate } from '@/lib/queries';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

const MAX_KEYWORDS_PER_PROJECT = 5000;

export async function GET(request: Request, { params }: Params) {
  return route('GET /api/projects/[id]/keywords', async () => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

    const url = new URL(request.url);
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));

    const rows = decorate(await getKeywordRows(project.id));
    const filtered = applyFilters(rows, query);

    return NextResponse.json(paginate(filtered, query.page, query.pageSize));
  });
}

export async function POST(request: Request, { params }: Params) {
  return route('POST /api/projects/[id]/keywords', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

    const input = await parseBody(request, addKeywordsSchema);

    // Either a pasted block of text or pre-parsed rows from the CSV preview.
    const entries = input.keywords?.length
      ? input.keywords.map((entry) => ({
          keyword: entry.keyword,
          targetUrl: normalizeTargetUrl(entry.targetUrl ?? null),
        }))
      : parseKeywordList(input.text ?? '', { maxKeywords: MAX_KEYWORDS_PER_IMPORT }).keywords;

    if (entries.length === 0) {
      throw new ApiError(400, 'Please add at least one keyword.');
    }

    const target = await resolveKeywordTarget(project, input, requestId);
    const rows = buildKeywordRows(project.id, entries, target);

    // The cap counts rows, not keyword texts: tracking one keyword on two
    // devices is two SERP calls on every check, so it costs two.
    const existingCount = await prisma.keyword.count({ where: { projectId: project.id } });
    if (existingCount + rows.length > MAX_KEYWORDS_PER_PROJECT) {
      throw new ApiError(
        400,
        `A project can hold at most ${MAX_KEYWORDS_PER_PROJECT} keywords. This project has ${existingCount}, and ${entries.length} keyword${entries.length === 1 ? '' : 's'} on ${target.devices.length} device${target.devices.length === 1 ? '' : 's'} would add ${rows.length}.`,
      );
    }

    // Existing keywords are skipped rather than duplicated, so re-importing
    // a list is safe and keeps ranking history attached to the same rows.
    const result = await prisma.keyword.createMany({ data: rows, skipDuplicates: true });

    logger.info('keywords added', {
      requestId,
      userId: user.id,
      projectId: project.id,
      submitted: entries.length,
      devices: target.devices,
      locationCode: target.locationCode,
      created: result.count,
    });

    return NextResponse.json(
      {
        created: result.count,
        skipped: rows.length - result.count,
        total: existingCount + result.count,
        devices: target.devices,
      },
      { status: 201 },
    );
  });
}

/**
 * Delete one keyword.
 *
 * Its Ranking rows cascade, so the keyword's position history goes with it.
 * The confirm dialog says so — it is not obvious to someone who expects this
 * to only stop future checks.
 */
export async function DELETE(request: Request, { params }: Params) {
  return route('DELETE /api/projects/[id]/keywords', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

    limitKeywordDelete(user.id);

    await assertNoRunningCheck(project.id);

    const url = new URL(request.url);
    const query = deleteKeywordQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!query.success) throw new ApiError(400, 'No keyword was specified.');
    const { keywordId } = query.data;

    // Scoped to the project, which is already scoped to the user.
    const deleted = await prisma.keyword.deleteMany({
      where: { id: keywordId, projectId: project.id },
    });
    if (deleted.count === 0) throw new ApiError(404, 'That keyword could not be found.');

    logger.info('keyword deleted', {
      requestId,
      userId: user.id,
      projectId: project.id,
      keywordId,
    });

    return NextResponse.json({ ok: true });
  });
}
