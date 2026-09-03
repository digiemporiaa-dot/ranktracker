import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Globe, ListChecks, TrendingUp } from 'lucide-react';

import { prisma } from '@/lib/db';
import { requireProject, requireUser } from '@/lib/api';
import { decorate, getKeywordRows, summarize } from '@/lib/queries';
import { env, hasDataForSeoCredentials } from '@/lib/env';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatsCards } from '@/components/stats-cards';
import { KeywordImport } from '@/components/keyword-import';
import { RankCheckButton } from '@/components/rank-check-button';
import { RankingsTable, type RankingRow } from '@/components/rankings-table';
import {
  EditProjectDialog,
  ProjectDangerZone,
  type EditableProject,
} from '@/components/project-settings';
import { COUNTRIES, type CountryCode } from '@/config/serp';
import { formatDateTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export default async function ProjectPage({ params }: Params) {
  const user = await requireUser();
  const { id } = await params;

  const project = await requireProject(user.id, id).catch(() => null);
  if (!project) notFound();

  const raw = await getKeywordRows(project.id);
  const rows = decorate(raw);
  const { stats, lastCheckedAt } = summarize(raw);

  const activeCheck = await prisma.rankCheck.findFirst({
    where: { projectId: project.id, status: { in: ['PENDING', 'RUNNING'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  const tableRows: RankingRow[] = rows.map((row) => ({
    id: row.id,
    keyword: row.keyword,
    targetUrl: row.targetUrl,
    position: row.position,
    rankingUrl: row.rankingUrl,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    previousPosition: row.previousPosition,
    changeKind: row.changeKind,
    changeDelta: row.changeDelta,
    changeLabel: row.changeLabel,
  }));

  const hasRankings = rows.some((row) => row.checkedAt !== null);

  const editable: EditableProject = {
    id: project.id,
    name: project.name,
    domain: project.domain,
    country: project.country,
    language: project.language,
    device: project.device,
  };

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              {project.domain}
            </span>
            <span>Last checked: {formatDateTime(lastCheckedAt)}</span>
            <Badge variant="outline">
              {COUNTRIES[project.country as CountryCode]?.label ?? project.country}
            </Badge>
            <Badge variant="outline">{project.device === 'MOBILE' ? 'Mobile' : 'Desktop'}</Badge>
            {project.isDemo ? <Badge variant="secondary">Demo data</Badge> : null}
          </span>
        }
        actions={
          <>
            <EditProjectDialog project={editable} />
            {hasRankings ? (
              <Button variant="outline" asChild>
                <a href={`/api/projects/${project.id}/export`}>
                  <Download className="h-4 w-4" />
                  Export CSV
                </a>
              </Button>
            ) : null}
            <RankCheckButton
              projectId={project.id}
              keywordCount={rows.length}
              country={project.country}
              language={project.language}
              device={project.device}
              depth={env.SERP_RESULTS}
              activeCheckId={activeCheck?.id ?? null}
            />
          </>
        }
      />

      {!hasDataForSeoCredentials() ? (
        <Alert tone="error" title="SERP provider not configured" className="mb-6">
          Ranking checks are unavailable until <code className="font-mono">DATAFORSEO_LOGIN</code>{' '}
          and <code className="font-mono">DATAFORSEO_PASSWORD</code> are set in the server
          environment. No ranking data is invented in the meantime.
        </Alert>
      ) : null}

      <StatsCards stats={stats} />

      <div className="mt-8 space-y-8">
        {rows.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No keywords yet."
            description="Upload a CSV or paste your keywords to get started."
          />
        ) : !hasRankings ? (
          <EmptyState
            icon={TrendingUp}
            title="No ranking data yet."
            description="Run your first ranking check to see where this website ranks."
          />
        ) : (
          <RankingsTable rows={tableRows} projectId={project.id} />
        )}

        <KeywordImport projectId={project.id} />

        <ProjectDangerZone project={editable} keywordCount={rows.length} />
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        <Link href="/projects" className="hover:underline">
          ← All projects
        </Link>
      </p>
    </>
  );
}
