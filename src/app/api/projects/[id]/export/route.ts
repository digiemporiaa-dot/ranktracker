import { requireProject, requireUser, route } from '@/lib/api';
import { listQuerySchema } from '@/lib/validation';
import { applyFilters, decorate, getKeywordRows } from '@/lib/queries';
import { toCsv } from '@/lib/csv';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

export async function GET(request: Request, { params }: Params) {
  return route('GET /api/projects/[id]/export', async ({ requestId }) => {
    const user = await requireUser();
    const { id } = await params;
    const project = await requireProject(user.id, id);

    const url = new URL(request.url);
    const query = listQuerySchema.parse({
      ...Object.fromEntries(url.searchParams),
      // Exports are never paginated.
      page: 1,
      pageSize: 200,
    });

    const rows = applyFilters(decorate(await getKeywordRows(project.id)), {
      search: query.search,
      filter: query.filter,
      sort: query.sort,
      direction: query.direction,
    });

    // Every cell goes through toCsv, which escapes and de-fangs formulas.
    const csv = toCsv(
      ['keyword', 'position', 'change', 'target_url', 'ranking_url', 'checked_at'],
      rows.map((row) => [
        row.keyword,
        row.position ?? 'Not Found',
        row.changeDelta ?? (row.changeKind === 'none' ? '' : row.changeLabel),
        row.targetUrl ?? '',
        row.rankingUrl ?? '',
        row.checkedAt ? row.checkedAt.toISOString() : '',
      ]),
    );

    logger.info('rankings exported', {
      requestId,
      userId: user.id,
      projectId: project.id,
      rows: rows.length,
    });

    const filename = `${slugify(project.name)}-rankings-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
