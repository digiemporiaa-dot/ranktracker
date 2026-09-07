import Link from 'next/link';
import { Download, Plus, TrendingUp } from 'lucide-react';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/api';
import { projectScope } from '@/lib/scope';
import { decorate, getKeywordRows, summarize, toTableRows } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { ProjectSwitcher } from '@/components/project-switcher';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatsCards } from '@/components/stats-cards';
import { RankingsTable, type RankingRow } from '@/components/rankings-table';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Rankings · OurRankTracker' };
export const dynamic = 'force-dynamic';

type Search = { searchParams: Promise<{ project?: string }> };

export default async function RankingsPage({ searchParams }: Search) {
  const user = await requireUser();
  const { project: requestedProjectId } = await searchParams;

  const projects = await prisma.project.findMany({
    where: projectScope(user),
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, domain: true },
  });

  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Rankings" />
        <EmptyState
          icon={TrendingUp}
          title="Create your first project"
          description="Rankings appear once a project has keywords and a completed check."
          actions={
            <Button asChild>
              <Link href="/projects/new">
                <Plus className="h-4 w-4" />
                Create Project
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  // Only a project the user owns can be selected.
  const selected =
    projects.find((project) => project.id === requestedProjectId) ?? projects[0];

  const raw = await getKeywordRows(selected.id);
  const rows = decorate(raw);
  const { stats, lastCheckedAt } = summarize(raw);
  const hasRankings = rows.some((row) => row.checkedAt !== null);

  const tableRows: RankingRow[] = toTableRows(rows);

  return (
    <>
      <PageHeader
        title="Rankings"
        description={`${selected.domain} · Last checked: ${formatDateTime(lastCheckedAt)}`}
        actions={
          <>
            {projects.length > 1 ? (
              <ProjectSwitcher projects={projects} selectedId={selected.id} />
            ) : null}
            {hasRankings ? (
              <Button variant="outline" asChild>
                <a href={`/api/projects/${selected.id}/export`}>
                  <Download className="h-4 w-4" />
                  Export CSV
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      <StatsCards stats={stats} />

      <div className="mt-8">
        {!hasRankings ? (
          <EmptyState
            icon={TrendingUp}
            title="No ranking data yet."
            description="Run your first ranking check to see where this website ranks."
            actions={
              <Button asChild>
                <Link href={`/projects/${selected.id}`}>Check Rankings</Link>
              </Button>
            }
          />
        ) : (
          <RankingsTable rows={tableRows} projectId={selected.id} />
        )}
      </div>
    </>
  );
}
