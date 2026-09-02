import Link from 'next/link';
import { FolderKanban, Globe, Plus } from 'lucide-react';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/api';
import { getKeywordRows, summarize } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatsCards } from '@/components/stats-cards';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Dashboard · OurRankTracker' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, domain: true, isDemo: true },
  });

  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          icon={FolderKanban}
          title="Create your first project"
          description="Add a website and its keywords to start tracking Google rankings."
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

  // The dashboard headlines the most recent project and summarizes the rest.
  const primary = projects[0];
  const rows = await getKeywordRows(primary.id);
  const { stats, lastCheckedAt } = summarize(rows);

  return (
    <>
      <PageHeader
        title={primary.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              {primary.domain}
            </span>
            <span>Last checked: {formatDateTime(lastCheckedAt)}</span>
            {primary.isDemo ? <Badge variant="secondary">Demo data</Badge> : null}
          </span>
        }
        actions={
          <Button asChild>
            <Link href={`/projects/${primary.id}`}>Open project</Link>
          </Button>
        }
      />

      <StatsCards stats={stats} />

      {projects.length > 1 ? (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Other projects</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.slice(1).map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="group">
                <Card className="transition-colors group-hover:border-primary/40">
                  <CardContent className="p-4">
                    <p className="truncate font-medium">{project.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{project.domain}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
