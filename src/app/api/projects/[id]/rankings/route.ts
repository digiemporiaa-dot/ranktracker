import { NextResponse } from 'next/server';

import { requireProject, requireUser, route } from '@/lib/api';
import { listQuerySchema } from '@/lib/validation';
import { applyFilters, decorate, getKeywordRows, paginate, summarize } from '@/lib/queries';

type Params = { params: Promise<{ id: string }> };

/**
 * Paginated ranking table.
 *
 * Only the latest and previous ranking per keyword are read — the full history
 * is never sent to the browser.
 */
export async function GET(request: Request, { params }: Params) {
  return route('GET /api/projects/[id]/rankings', async () => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user, id);

    const url = new URL(request.url);
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams));

    const raw = await getKeywordRows(project.id);
    const decorated = decorate(raw);
    const filtered = applyFilters(decorated, query);
    const page = paginate(filtered, query.page, query.pageSize);
    const { stats, lastCheckedAt } = summarize(raw);

    return NextResponse.json({ ...page, stats, lastCheckedAt });
  });
}
