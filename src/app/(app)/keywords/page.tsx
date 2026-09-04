import Link from 'next/link';
import { ListChecks, Plus } from 'lucide-react';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/api';
import { projectScope } from '@/lib/scope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deviceLabel } from '@/config/serp';
import { locationLabel } from '@/components/search-summary';

export const metadata = { title: 'Keywords · OurRankTracker' };
export const dynamic = 'force-dynamic';

export default async function KeywordsPage() {
  const user = await requireUser();

  const projects = await prisma.project.findMany({
    where: projectScope(user),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      domain: true,
      keywords: {
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          keyword: true,
          targetUrl: true,
          country: true,
          city: true,
          device: true,
          active: true,
        },
      },
      _count: { select: { keywords: true } },
    },
  });

  const withKeywords = projects.filter((project) => project.keywords.length > 0);

  if (projects.length === 0) {
    return (
      <>
        <PageHeader title="Keywords" />
        <EmptyState
          icon={ListChecks}
          title="Create your first project"
          description="Keywords live inside a project."
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

  if (withKeywords.length === 0) {
    return (
      <>
        <PageHeader title="Keywords" />
        <EmptyState
          icon={ListChecks}
          title="No keywords yet."
          description="Upload a CSV or paste your keywords into a project."
          actions={
            <Button asChild>
              <Link href={`/projects/${projects[0].id}`}>Open {projects[0].name}</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Keywords" description="Every keyword you are tracking, by project." />

      <div className="space-y-6">
        {withKeywords.map((project) => (
          <Card key={project.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>
                  <Link href={`/projects/${project.id}`} className="hover:underline">
                    {project.name}
                  </Link>
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {project._count.keywords} keyword{project._count.keywords === 1 ? '' : 's'}
                  {project._count.keywords > project.keywords.length
                    ? ` · showing the first ${project.keywords.length}`
                    : ''}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${project.id}`}>Manage</Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Keyword</TableHead>
                    <TableHead>Target URL</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Device</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {project.keywords.map((keyword) => (
                    <TableRow key={keyword.id}>
                      <TableCell className="font-medium">
                        {keyword.keyword}
                        {!keyword.active ? (
                          <Badge variant="outline" className="ml-2">
                            Paused
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {keyword.targetUrl ?? '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {locationLabel(keyword.country, keyword.city)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {deviceLabel(keyword.device)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
