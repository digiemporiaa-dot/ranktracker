import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { ApiError, parseBody, requireProject, requireUser, route } from '@/lib/api';
import { importKeywordsSchema } from '@/lib/validation';
import { MAX_CSV_BYTES, MAX_KEYWORDS_PER_IMPORT, parseKeywordCsv } from '@/lib/csv';
import { buildKeywordRows, resolveKeywordTarget } from '@/lib/keywords';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

const MAX_KEYWORDS_PER_PROJECT = 5000;

/**
 * CSV import.
 *
 * With `commit: false` the file is parsed and a preview is returned without
 * touching the database — that is what the import dialog shows before the
 * user confirms.
 */
export async function POST(request: Request, { params }: Params) {
  return route('POST /api/projects/[id]/keywords/import', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

    const input = await parseBody(request, importKeywordsSchema);

    if (Buffer.byteLength(input.csv, 'utf8') > MAX_CSV_BYTES) {
      throw new ApiError(
        400,
        `That file is too large. The limit is ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const parsed = parseKeywordCsv(input.csv, { maxKeywords: MAX_KEYWORDS_PER_IMPORT });

    if (parsed.keywords.length === 0) {
      throw new ApiError(400, parsed.errors[0] ?? 'No valid keywords were found in that file.');
    }

    const preview = {
      keywords: parsed.keywords.slice(0, 50),
      totalParsed: parsed.keywords.length,
      duplicates: parsed.duplicates,
      skippedRows: parsed.skippedRows,
      warnings: parsed.errors,
    };

    if (!input.commit) {
      return NextResponse.json({ committed: false, ...preview });
    }

    const target = await resolveKeywordTarget(project, input, requestId);
    const rows = buildKeywordRows(project.id, parsed.keywords, target);

    const existingCount = await prisma.keyword.count({ where: { projectId: project.id } });
    if (existingCount + rows.length > MAX_KEYWORDS_PER_PROJECT) {
      throw new ApiError(
        400,
        `A project can hold at most ${MAX_KEYWORDS_PER_PROJECT} keywords. This project has ${existingCount}, and ${parsed.keywords.length} keyword${parsed.keywords.length === 1 ? '' : 's'} on ${target.devices.length} device${target.devices.length === 1 ? '' : 's'} would add ${rows.length}.`,
      );
    }

    const result = await prisma.keyword.createMany({ data: rows, skipDuplicates: true });

    logger.info('keywords imported', {
      requestId,
      userId: user.id,
      projectId: project.id,
      parsed: parsed.keywords.length,
      devices: target.devices,
      locationCode: target.locationCode,
      created: result.count,
    });

    return NextResponse.json(
      {
        committed: true,
        created: result.count,
        skipped: rows.length - result.count,
        devices: target.devices,
        ...preview,
      },
      { status: 201 },
    );
  });
}
