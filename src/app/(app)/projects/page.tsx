import Link from 'next/link';
import { FolderKanban, Globe, Plus, User as UserIcon } from 'lucide-react';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/api';
import { isSuperadmin } from '@/lib/auth';
import { projectScope } from '@/lib/scope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { OwnerFilter } from '@/components/owner-filter';
import { COUNTRIES, type CountryCode } from '@/config/serp';

export const metadata = { title: 'Projects · OurRankTracker' };
export const dynamic = 'force-dynamic';

type Search = { searchParams: Promise<{ owner?: string }> };

/**
 * The project list.
 *
 * An executive sees exactly what they saw before roles existed: their own
 * projects, no owner column, no filter, no totals. Nothing on this page hints
 * that anyone else's data is there.
 *
 * A superadmin sees every project, so they also get the three things needed to
 * make sense of one undifferentiated pile: whose each project is, a filter by
 * executive, and totals across the instance.
 */
export default async function ProjectsPage({ searchParams }: Search) {
  const user = await requireUser();
  const admin = isSuperadmin(user);

  const { owner: requestedOwner } = await searchParams;

  // The owner filter narrows what a superadmin sees; for an executive the
  // parameter is ignored entirely, so it can never widen their scope.
  const ownerFilter = admin && requestedOwner ? { userId: requestedOwner } : {};

  const projects = await prisma.project.findMany({
    where: { ...projectScope(user), ...ownerFilter },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      domain: true,
      country: true,
      device: true,
      isDemo: true,
      _count: { select: { keywords: true } },
      ...(admin ? { user: { select: { id: true, email: true, name: true } } } : {}),
    },
  });

  // Totals are for the superadmin summary only, and cover the whole instance
  // rather than the current filter — they answer "how much is in here?".
  const [totalProjects, totalKeywords, activeChecks, owners] = admin
    ? await Promise.all([
        prisma.project.count(),
        prisma.keyword.count(),
        prisma.rankCheck.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
        prisma.user.findMany({
          where: { projects: { some: {} } },
          orderBy: { email: 'asc' },
          select: { id: true, email: true, _count: { select: { projects: true } } },
        }),
      ])
    : [0, 0, 0, []];

  const filteredOwner = owners.find((candidate) => candidate.id === requestedOwner);

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          admin ? 'Every project on this instance.' : 'Every website you are tracking.'
        }
        actions={
          projects.length > 0 ? (
            <Button asChild>
              <Link href="/projects/new">
                <Plus className="h-4 w-4" />
                New project
              </Link>
            </Button>
          ) : null
        }
      />

      {admin ? (
        <div className="mb-6 space-y-4">
          <dl className="grid grid-cols-3 gap-3">
            {[
              { label: 'Projects', value: totalProjects },
              { label: 'Keywords', value: totalKeywords },
              { label: 'Active checks', value: activeChecks },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </dt>
                  <dd className="mt-1.5 text-2xl font-semibold tabular-nums">{stat.value}</dd>
                </CardContent>
              </Card>
            ))}
          </dl>

          <OwnerFilter owners={owners} selectedId={requestedOwner ?? ''} />
        </div>
      ) : null}

      {projects.length === 0 ? (
        admin && filteredOwner ? (
          <EmptyState
            icon={FolderKanban}
            title={`${filteredOwner.email} has no projects`}
            description="Clear the filter to see everything again."
            actions={
              <Button variant="outline" asChild>
                <Link href="/projects">Show all projects</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="Create your first project"
            description="A project is a website plus the keywords you want to rank for."
            actions={
              <Button asChild>
                <Link href="/projects/new">
                  <Plus className="h-4 w-4" />
                  Create Project
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const owner = 'user' in project ? project.user : null;

            return (
              <Link key={project.id} href={`/projects/${project.id}`} className="group">
                <Card className="h-full transition-colors group-hover:border-primary/40">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate font-semibold">{project.name}</h2>
                      {project.isDemo ? <Badge variant="secondary">Demo</Badge> : null}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      {project.domain}
                    </p>

                    {owner ? (
                      <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                        <UserIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate" title={owner.email}>
                          {owner.email}
                        </span>
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">
                        {project._count.keywords} keyword
                        {project._count.keywords === 1 ? '' : 's'}
                      </Badge>
                      <Badge variant="outline">
                        {COUNTRIES[project.country as CountryCode]?.label ?? project.country}
                      </Badge>
                      <Badge variant="outline">
                        {project.device === 'MOBILE' ? 'Mobile' : 'Desktop'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
