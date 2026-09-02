import Link from 'next/link';
import { FolderKanban, Globe, Plus } from 'lucide-react';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { COUNTRIES, type CountryCode } from '@/config/serp';

export const metadata = { title: 'Projects · OurRankTracker' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const user = await requireUser();

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      domain: true,
      country: true,
      device: true,
      isDemo: true,
      _count: { select: { keywords: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every website you are tracking."
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

      {projects.length === 0 ? (
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
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
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                      {project._count.keywords} keyword{project._count.keywords === 1 ? '' : 's'}
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
          ))}
        </div>
      )}
    </>
  );
}
