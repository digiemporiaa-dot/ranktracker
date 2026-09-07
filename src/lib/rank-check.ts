import 'server-only';

import type { Device, Keyword, Project } from '@prisma/client';

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { checkKeywordRanking, DataForSeoError } from '@/lib/dataforseo';
import { fetchSerpCached, pruneSerpCache } from '@/lib/serp-cache';
import type { CountryCode, LanguageCode } from '@/config/serp';

/**
 * Runs a ranking check for a project.
 *
 * Keywords are processed in bounded-concurrency batches so we never open 500
 * connections to DataForSEO at once. Progress is written to the RankCheck row
 * after every keyword, which is what the dashboard polls.
 *
 * Rankings are always inserted, never updated: history is append-only.
 */

type RunnableKeyword = Pick<
  Keyword,
  | 'id'
  | 'keyword'
  | 'targetUrl'
  | 'country'
  | 'city'
  | 'locationCode'
  | 'googleDomain'
  | 'language'
  | 'device'
>;

export async function startRankCheck(opts: {
  project: Pick<Project, 'id' | 'domain' | 'userId'>;
  keywords: RunnableKeyword[];
  depth: number;
  requestId: string;
}): Promise<string> {
  const { project, keywords, depth, requestId } = opts;

  const rankCheck = await prisma.rankCheck.create({
    data: {
      projectId: project.id,
      status: 'PENDING',
      totalKeywords: keywords.length,
    },
  });

  // Deliberately not awaited: the HTTP response returns immediately and the
  // client polls GET /api/rank-check/[id] for progress.
  void runRankCheck({ rankCheckId: rankCheck.id, project, keywords, depth, requestId }).catch(
    (error) => {
      logger.error('rank check crashed', {
        requestId,
        rankCheckId: rankCheck.id,
        projectId: project.id,
        error,
      });
    },
  );

  return rankCheck.id;
}

async function runRankCheck(opts: {
  rankCheckId: string;
  project: Pick<Project, 'id' | 'domain' | 'userId'>;
  keywords: RunnableKeyword[];
  depth: number;
  requestId: string;
}): Promise<void> {
  const { rankCheckId, project, keywords, depth, requestId } = opts;
  const startedAt = Date.now();

  await pruneSerpCache();

  await prisma.rankCheck.update({
    where: { id: rankCheckId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  logger.info('rank check started', {
    requestId,
    rankCheckId,
    projectId: project.id,
    userId: project.userId,
    totalKeywords: keywords.length,
    depth,
  });

  let completed = 0;
  let failed = 0;
  let fatalMessage: string | null = null;

  const concurrency = Math.max(1, Math.min(env.SERP_CONCURRENCY, 20));
  const queue = [...keywords];

  const worker = async () => {
    for (;;) {
      if (fatalMessage) return;
      const keyword = queue.shift();
      if (!keyword) return;

      const keywordStartedAt = Date.now();
      try {
        // Every field comes from the keyword row, which is where its location
        // and device were fixed when it was created. Two keywords that differ
        // only by device produce two separate provider calls.
        const lookup = {
          keyword: keyword.keyword,
          domain: project.domain,
          country: keyword.country as CountryCode,
          city: keyword.city,
          locationCode: keyword.locationCode,
          googleDomain: keyword.googleDomain,
          language: keyword.language as LanguageCode,
          device: keyword.device as Device,
          results: depth,
        };

        const { organic, cached } = await fetchSerpCached(lookup, requestId);
        const result = await checkKeywordRanking(lookup, organic, requestId);

        // The configuration is written onto the ranking as well as being
        // implied by the keyword, so a stored position can always be read back
        // with the device and location it was actually measured on.
        await prisma.ranking.create({
          data: {
            keywordId: keyword.id,
            rankCheckId,
            position: result.position,
            rankingUrl: result.rankingUrl,
            resultsChecked: result.resultsChecked,
            device: keyword.device,
            locationCode: keyword.locationCode,
            googleDomain: keyword.googleDomain,
            checkedAt: new Date(),
          },
        });

        completed += 1;
        logger.info('keyword checked', {
          requestId,
          rankCheckId,
          projectId: project.id,
          keywordId: keyword.id,
          status: 'ok',
          position: result.position,
          device: keyword.device,
          locationCode: keyword.locationCode,
          cached,
          durationMs: Date.now() - keywordStartedAt,
        });
      } catch (error) {
        failed += 1;

        // Credential and billing failures will fail for every remaining
        // keyword too — stop the run rather than burn through the queue.
        if (
          error instanceof DataForSeoError &&
          !error.retryable &&
          (error.statusCode === 401 ||
            error.statusCode === 402 ||
            error.statusCode === 403 ||
            error.statusCode === 40100 ||
            error.statusCode === 40200 ||
            error.name === 'DataForSeoNotConfiguredError')
        ) {
          fatalMessage = error.userMessage;
        }

        logger.error('keyword check failed', {
          requestId,
          rankCheckId,
          projectId: project.id,
          keywordId: keyword.id,
          status: 'failed',
          durationMs: Date.now() - keywordStartedAt,
          error,
        });
      }

      await prisma.rankCheck
        .update({
          where: { id: rankCheckId },
          data: { completedKeywords: completed, failedKeywords: failed },
        })
        .catch((error) => logger.warn('progress update failed', { requestId, error }));
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const status =
    fatalMessage || (completed === 0 && failed > 0)
      ? 'FAILED'
      : failed > 0
        ? 'PARTIAL'
        : 'COMPLETED';

  await prisma.rankCheck.update({
    where: { id: rankCheckId },
    data: {
      status,
      completedKeywords: completed,
      failedKeywords: failed,
      completedAt: new Date(),
      message:
        fatalMessage ??
        (failed > 0
          ? `${failed} keyword${failed === 1 ? '' : 's'} could not be checked. You can run the check again.`
          : null),
    },
  });

  logger.info('rank check finished', {
    requestId,
    rankCheckId,
    projectId: project.id,
    status,
    completed,
    failed,
    durationMs: Date.now() - startedAt,
  });
}
