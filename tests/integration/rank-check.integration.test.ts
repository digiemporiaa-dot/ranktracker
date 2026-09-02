/**
 * End-to-end ranking pipeline against a real PostgreSQL database.
 *
 * Only the DataForSEO HTTP call is stubbed — everything else is the real code
 * path: the concurrency-limited runner, SERP parsing, domain matching, the
 * append-only Ranking writes, RankCheck progress, the dashboard query and the
 * CSV export.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set:
 *   INTEGRATION_DATABASE_URL=postgresql://... npx vitest run tests/integration
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const INTEGRATION_URL = process.env.INTEGRATION_DATABASE_URL;
const describeIf = INTEGRATION_URL ? describe : describe.skip;

/** SERP fixtures keyed by keyword: the organic URLs, in order. */
type Serp = Record<string, string[]>;

function serpResponse(urls: string[]) {
  const items = [
    // Two ads first — these must not shift the organic numbering.
    { type: 'paid', rank_absolute: 1, url: 'https://ads.example.com/a', domain: 'ads.example.com' },
    { type: 'paid', rank_absolute: 2, url: 'https://ads.example.com/b', domain: 'ads.example.com' },
    ...urls.map((url, index) => ({
      type: 'organic',
      rank_absolute: index + 3,
      rank_group: index + 1,
      url,
      domain: new URL(url).hostname,
      title: `Result ${index + 1}`,
    })),
  ];
  return { status_code: 20000, tasks: [{ result: [{ items }] }] };
}

function stubDataForSeo(serps: Serp, onCall?: () => void) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      onCall?.();
      const body = JSON.parse(String(init.body)) as { keyword: string }[];
      const urls = serps[body[0].keyword] ?? [];
      return {
        ok: true,
        status: 200,
        json: async () => serpResponse(urls),
      } as unknown as Response;
    }),
  );
}

describeIf('rank check pipeline (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let userId: string;
  let projectId: string;

  const DOMAIN = 'wroffy.com';
  const KEYWORDS = [
    'microsoft reseller india',
    'azure reseller india',
    'microsoft partner india',
    'microsoft 365 reseller',
    'office 365 partner india',
  ];

  // First check: positions 1, 8, not-found, 3 (via subdomain), 20.
  const FIRST: Serp = {
    'microsoft reseller india': ['https://www.wroffy.com/microsoft-reseller', 'https://a.com/1'],
    'azure reseller india': [
      ...Array.from({ length: 7 }, (_, i) => `https://other-${i}.com/x`),
      'https://wroffy.com/azure',
    ],
    'microsoft partner india': [
      // Lookalikes only — must not match.
      'https://fakewroffy.com/a',
      'https://wroffy.com.evil.com/b',
      'https://example.com/wroffy.com',
    ],
    'microsoft 365 reseller': [
      'https://x.com/1',
      'https://y.com/2',
      'https://blog.wroffy.com/m365',
    ],
    'office 365 partner india': [
      ...Array.from({ length: 19 }, (_, i) => `https://z-${i}.com/x`),
      'https://wroffy.com/office-365',
    ],
  };

  // Second check: 1 -> 1 (same), 8 -> 3 (up 5), not-found -> 2 (New),
  // 3 -> 9 (down 6), 20 -> not-found (Lost).
  const SECOND: Serp = {
    'microsoft reseller india': ['https://www.wroffy.com/microsoft-reseller', 'https://a.com/1'],
    'azure reseller india': [
      'https://p.com/1',
      'https://q.com/2',
      'https://wroffy.com/azure',
    ],
    'microsoft partner india': ['https://r.com/1', 'https://shop.wroffy.com/partner'],
    'microsoft 365 reseller': [
      ...Array.from({ length: 8 }, (_, i) => `https://s-${i}.com/x`),
      'https://blog.wroffy.com/m365',
    ],
    'office 365 partner india': ['https://t.com/1', 'https://u.com/2'],
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = INTEGRATION_URL;
    process.env.DATAFORSEO_LOGIN = 'integration-login';
    process.env.DATAFORSEO_PASSWORD = 'integration-password';
    // Caching off, so both checks really call the provider.
    process.env.SERP_CACHE_MINUTES = '0';
    process.env.SERP_CONCURRENCY = '3';

    vi.resetModules();
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();

    await prisma.user.deleteMany({ where: { email: 'integration@test.local' } });
    const user = await prisma.user.create({
      data: {
        email: 'integration@test.local',
        name: 'Integration',
        passwordHash: 'not-used',
      },
    });
    userId = user.id;

    const project = await prisma.project.create({
      data: { userId, name: 'Integration Project', domain: DOMAIN, country: 'IN', language: 'en' },
    });
    projectId = project.id;

    await prisma.keyword.createMany({
      data: KEYWORDS.map((keyword) => ({
        projectId,
        keyword,
        country: 'IN',
        language: 'en',
        device: 'DESKTOP' as const,
      })),
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
    vi.unstubAllGlobals();
  });

  async function runCheck(serps: Serp) {
    let calls = 0;
    stubDataForSeo(serps, () => {
      calls += 1;
    });

    const { startRankCheck } = await import('@/lib/rank-check');
    const keywords = await prisma.keyword.findMany({
      where: { projectId },
      select: { id: true, keyword: true, targetUrl: true, country: true, language: true, device: true },
      orderBy: { createdAt: 'asc' },
    });

    const rankCheckId = await startRankCheck({
      project: { id: projectId, domain: DOMAIN, userId },
      keywords,
      depth: 100,
      requestId: 'integration',
    });

    // Wait for the background run to finish.
    for (let i = 0; i < 100; i += 1) {
      const check = await prisma.rankCheck.findUnique({ where: { id: rankCheckId } });
      if (check && ['COMPLETED', 'PARTIAL', 'FAILED'].includes(check.status)) {
        return { rankCheckId, check, calls };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('rank check did not finish in time');
  }

  it('runs the first check and records positions, ignoring ads and lookalikes', async () => {
    const { check, calls } = await runCheck(FIRST);

    expect(check.status).toBe('COMPLETED');
    expect(check.totalKeywords).toBe(5);
    expect(check.completedKeywords).toBe(5);
    expect(check.failedKeywords).toBe(0);
    expect(calls).toBe(5);

    const { getKeywordRows } = await import('@/lib/queries');
    const rows = await getKeywordRows(projectId);
    const byKeyword = Object.fromEntries(rows.map((row) => [row.keyword, row]));

    // Two ads precede the organic block, so the first organic result is #1.
    expect(byKeyword['microsoft reseller india'].position).toBe(1);
    expect(byKeyword['microsoft reseller india'].rankingUrl).toBe(
      'https://www.wroffy.com/microsoft-reseller',
    );

    expect(byKeyword['azure reseller india'].position).toBe(8);

    // fakewroffy.com, wroffy.com.evil.com and example.com/wroffy.com must not match.
    expect(byKeyword['microsoft partner india'].position).toBeNull();
    expect(byKeyword['microsoft partner india'].rankingUrl).toBeNull();

    // A subdomain counts.
    expect(byKeyword['microsoft 365 reseller'].position).toBe(3);
    expect(byKeyword['office 365 partner india'].position).toBe(20);

    // Nothing to compare against yet.
    for (const row of rows) expect(row.previousPosition).toBeNull();
  });

  it('runs a second check and computes every change correctly', async () => {
    await runCheck(SECOND);

    const { getKeywordRows, decorate, summarize } = await import('@/lib/queries');
    const rows = decorate(await getKeywordRows(projectId));
    const byKeyword = Object.fromEntries(rows.map((row) => [row.keyword, row]));

    const expected = [
      { keyword: 'microsoft reseller india', previous: 1, position: 1, label: '—', kind: 'same' },
      { keyword: 'azure reseller india', previous: 8, position: 3, label: '↑ 5', kind: 'up' },
      { keyword: 'microsoft partner india', previous: null, position: 2, label: 'New', kind: 'new' },
      { keyword: 'microsoft 365 reseller', previous: 3, position: 9, label: '↓ 6', kind: 'down' },
      { keyword: 'office 365 partner india', previous: 20, position: null, label: 'Lost', kind: 'lost' },
    ];

    for (const item of expected) {
      const row = byKeyword[item.keyword];
      expect(row.previousPosition, item.keyword).toBe(item.previous);
      expect(row.position, item.keyword).toBe(item.position);
      expect(row.changeLabel, item.keyword).toBe(item.label);
      expect(row.changeKind, item.keyword).toBe(item.kind);
    }

    const { stats } = summarize(await getKeywordRows(projectId));
    expect(stats.totalKeywords).toBe(5);
    expect(stats.top3).toBe(3); // #1, #3, #2
    expect(stats.top10).toBe(4); // plus #9
    expect(stats.notRanking).toBe(1);
    expect(stats.improved).toBe(2); // up + new
    expect(stats.dropped).toBe(2); // down + lost
  });

  it('never overwrites history — both checks are kept per keyword', async () => {
    const keyword = await prisma.keyword.findFirst({
      where: { projectId, keyword: 'azure reseller india' },
    });

    const history = await prisma.ranking.findMany({
      where: { keywordId: keyword!.id },
      orderBy: { checkedAt: 'asc' },
      select: { position: true },
    });

    expect(history.map((r) => r.position)).toEqual([8, 3]);

    const total = await prisma.ranking.count({ where: { keyword: { projectId } } });
    expect(total).toBe(10); // 5 keywords x 2 checks
  });

  it('records a partial run when some keywords fail', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        call += 1;
        // Fail one keyword permanently with a non-retryable request error.
        if (call === 1) return { ok: false, status: 400, json: async () => ({}) } as Response;
        const body = JSON.parse(String(init.body)) as { keyword: string }[];
        return {
          ok: true,
          status: 200,
          json: async () => serpResponse(SECOND[body[0].keyword] ?? []),
        } as unknown as Response;
      }),
    );

    const { startRankCheck } = await import('@/lib/rank-check');
    const keywords = await prisma.keyword.findMany({
      where: { projectId },
      select: { id: true, keyword: true, targetUrl: true, country: true, language: true, device: true },
      orderBy: { createdAt: 'asc' },
    });

    const rankCheckId = await startRankCheck({
      project: { id: projectId, domain: DOMAIN, userId },
      keywords,
      depth: 100,
      requestId: 'integration-partial',
    });

    let check = null;
    for (let i = 0; i < 100; i += 1) {
      check = await prisma.rankCheck.findUnique({ where: { id: rankCheckId } });
      if (check && ['COMPLETED', 'PARTIAL', 'FAILED'].includes(check.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(check!.status).toBe('PARTIAL');
    expect(check!.failedKeywords).toBe(1);
    expect(check!.completedKeywords).toBe(4);
    expect(check!.message).toMatch(/could not be checked/i);
  });

  it('exports the rankings as CSV with safe cells', async () => {
    const { getKeywordRows, decorate } = await import('@/lib/queries');
    const { toCsv } = await import('@/lib/csv');

    const rows = decorate(await getKeywordRows(projectId));
    const csv = toCsv(
      ['keyword', 'position', 'change', 'ranking_url', 'checked_at'],
      rows.map((row) => [
        row.keyword,
        row.position ?? 'Not Found',
        row.changeDelta ?? row.changeLabel,
        row.rankingUrl ?? '',
        row.checkedAt ? row.checkedAt.toISOString() : '',
      ]),
    );

    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('keyword,position,change,ranking_url,checked_at');
    expect(lines).toHaveLength(6);
    expect(csv).toContain('microsoft reseller india');
    // No cell may begin a formula.
    for (const line of lines.slice(1)) {
      for (const cell of line.split(',')) {
        const first = cell.replace(/^"/, '').charAt(0);
        if (first) expect(first).not.toMatch(/[=+@]/);
      }
    }
  });
});
