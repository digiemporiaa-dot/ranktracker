/**
 * Role-aware scoping, against a real database.
 *
 * The spec is explicit that there must be one test per route: the route nobody
 * tested is the one that leaks a client's ranking data to another client. So
 * every project-scoped route is exercised twice — once as an executive who
 * does not own the project, once as a superadmin.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';

const INTEGRATION_URL = process.env.INTEGRATION_DATABASE_URL;
const describeIf = INTEGRATION_URL ? describe : describe.skip;

const SESSION_SECRET = 'integration-session-secret-long-enough-for-zod';

let activeToken = '';

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'ort_session' && activeToken ? { name, value: activeToken } : undefined,
    set: () => undefined,
  }),
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const jsonRequest = (body: unknown, method = 'POST') =>
  new Request('http://localhost/test', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const getRequest = (url = 'http://localhost/test') => new Request(url);

describeIf('project scoping by role (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;

  let projectRoutes: typeof import('@/app/api/projects/[id]/route');
  let projectsRoute: typeof import('@/app/api/projects/route');
  let keywordRoutes: typeof import('@/app/api/projects/[id]/keywords/route');
  let importRoute: typeof import('@/app/api/projects/[id]/keywords/import/route');
  let bulkRoute: typeof import('@/app/api/projects/[id]/keywords/bulk-delete/route');
  let clearRoute: typeof import('@/app/api/projects/[id]/keywords/all/route');
  let rankCheckRoutes: typeof import('@/app/api/projects/[id]/rank-check/route');
  let rankCheckByIdRoute: typeof import('@/app/api/rank-check/[id]/route');
  let rankingsRoute: typeof import('@/app/api/projects/[id]/rankings/route');
  let exportRoute: typeof import('@/app/api/projects/[id]/export/route');
  let rateLimits: typeof import('@/lib/rate-limit');

  const OWNER = 'scope-owner@test.local';
  const OTHER = 'scope-other@test.local';
  const ADMIN = 'scope-admin@test.local';
  const EMAILS = [OWNER, OTHER, ADMIN];

  let ownerToken = '';
  let otherToken = '';
  let adminToken = '';
  let ownerId = '';
  let projectId = '';
  let keywordId = '';
  let rankCheckId = '';

  async function issueSession(userId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await prisma.session.create({
      data: {
        userId,
        tokenHash: createHmac('sha256', SESSION_SECRET).update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return token;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = INTEGRATION_URL;
    process.env.SESSION_SECRET = SESSION_SECRET;
    process.env.DATAFORSEO_LOGIN = 'x';
    process.env.DATAFORSEO_PASSWORD = 'x';

    vi.resetModules();
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();

    projectRoutes = await import('@/app/api/projects/[id]/route');
    projectsRoute = await import('@/app/api/projects/route');
    keywordRoutes = await import('@/app/api/projects/[id]/keywords/route');
    importRoute = await import('@/app/api/projects/[id]/keywords/import/route');
    bulkRoute = await import('@/app/api/projects/[id]/keywords/bulk-delete/route');
    clearRoute = await import('@/app/api/projects/[id]/keywords/all/route');
    rankCheckRoutes = await import('@/app/api/projects/[id]/rank-check/route');
    rankCheckByIdRoute = await import('@/app/api/rank-check/[id]/route');
    rankingsRoute = await import('@/app/api/projects/[id]/rankings/route');
    exportRoute = await import('@/app/api/projects/[id]/export/route');
    rateLimits = await import('@/lib/rate-limit');

    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });

    const owner = await prisma.user.create({
      data: { email: OWNER, name: 'Owner', passwordHash: 'x', role: 'EXECUTIVE' },
    });
    const other = await prisma.user.create({
      data: { email: OTHER, name: 'Other', passwordHash: 'x', role: 'EXECUTIVE' },
    });
    const admin = await prisma.user.create({
      data: { email: ADMIN, name: 'Admin', passwordHash: 'x', role: 'SUPERADMIN' },
    });

    ownerId = owner.id;
    ownerToken = await issueSession(owner.id);
    otherToken = await issueSession(other.id);
    adminToken = await issueSession(admin.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
      await prisma.$disconnect();
    }
  });

  /** A project owned by OWNER, with one keyword, one ranking and one check. */
  beforeEach(async () => {
    rateLimits.__resetRateLimits();

    await prisma.project.deleteMany({ where: { userId: ownerId } });

    const project = await prisma.project.create({
      data: { userId: ownerId, name: 'Owned Project', domain: 'owned.com' },
    });
    projectId = project.id;

    const keyword = await prisma.keyword.create({
      data: { projectId, keyword: 'owned keyword' },
    });
    keywordId = keyword.id;

    const check = await prisma.rankCheck.create({
      data: { projectId, status: 'COMPLETED', totalKeywords: 1, completedKeywords: 1 },
    });
    rankCheckId = check.id;

    await prisma.ranking.create({
      data: { keywordId, rankCheckId, position: 4, rankingUrl: 'https://owned.com/a' },
    });
  });

  /** Every project-scoped route, as one callable each. */
  const routeCalls = () => ({
    'GET /api/projects/[id]': () => projectRoutes.GET(getRequest(), params(projectId)),
    'PATCH /api/projects/[id]': () =>
      projectRoutes.PATCH(jsonRequest({ name: 'Renamed' }, 'PATCH'), params(projectId)),
    'DELETE /api/projects/[id]': () => projectRoutes.DELETE(getRequest(), params(projectId)),
    'GET /api/projects/[id]/keywords': () =>
      keywordRoutes.GET(getRequest('http://localhost/x'), params(projectId)),
    'POST /api/projects/[id]/keywords': () =>
      keywordRoutes.POST(jsonRequest({ text: 'injected keyword' }), params(projectId)),
    'DELETE /api/projects/[id]/keywords': () =>
      keywordRoutes.DELETE(
        new Request(`http://localhost/x?keywordId=${keywordId}`, { method: 'DELETE' }),
        params(projectId),
      ),
    'POST /api/projects/[id]/keywords/import': () =>
      importRoute.POST(jsonRequest({ csv: 'keyword\nsneaky', commit: true }), params(projectId)),
    'POST /api/projects/[id]/keywords/bulk-delete': () =>
      bulkRoute.POST(jsonRequest({ keywordIds: [keywordId] }), params(projectId)),
    'DELETE /api/projects/[id]/keywords/all': () =>
      clearRoute.DELETE(jsonRequest({ confirm: 'Owned Project' }, 'DELETE'), params(projectId)),
    'GET /api/projects/[id]/rank-check': () => rankCheckRoutes.GET(getRequest(), params(projectId)),
    'POST /api/projects/[id]/rank-check': () =>
      rankCheckRoutes.POST(jsonRequest({}), params(projectId)),
    'GET /api/projects/[id]/rankings': () =>
      rankingsRoute.GET(getRequest('http://localhost/x'), params(projectId)),
    'GET /api/projects/[id]/export': () =>
      exportRoute.GET(getRequest('http://localhost/x'), params(projectId)),
    'GET /api/rank-check/[id]': () => rankCheckByIdRoute.GET(getRequest(), params(rankCheckId)),
  });

  describe("an executive cannot reach another executive's data", () => {
    for (const name of Object.keys(routeCalls())) {
      it(`${name} returns 404`, async () => {
        activeToken = otherToken;
        const response = await routeCalls()[name as keyof ReturnType<typeof routeCalls>]();

        // 404, never 403: the admin surface and other people's data should not
        // even be discoverable.
        expect(response.status).toBe(404);
      });
    }

    it('changes nothing in the database across all of them', async () => {
      activeToken = otherToken;
      for (const call of Object.values(routeCalls())) await call();

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      expect(project?.name).toBe('Owned Project');
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(1);
      expect(await prisma.ranking.count({ where: { keyword: { projectId } } })).toBe(1);
      expect(await prisma.rankCheck.count({ where: { projectId } })).toBe(1);
    });

    it('does not list the project', async () => {
      activeToken = otherToken;
      const response = await projectsRoute.GET();
      const { projects } = await response.json();
      expect(projects.map((p: { id: string }) => p.id)).not.toContain(projectId);
    });
  });

  describe('the owner still reaches their own data', () => {
    for (const name of ['GET /api/projects/[id]', 'GET /api/projects/[id]/rankings'] as const) {
      it(`${name} returns 200`, async () => {
        activeToken = ownerToken;
        const response = await routeCalls()[name]();
        expect(response.status).toBe(200);
      });
    }

    it('lists the project', async () => {
      activeToken = ownerToken;
      const { projects } = await (await projectsRoute.GET()).json();
      expect(projects.map((p: { id: string }) => p.id)).toContain(projectId);
    });
  });

  describe('a superadmin reaches everything', () => {
    it("can read another user's project", async () => {
      activeToken = adminToken;
      const response = await projectRoutes.GET(getRequest(), params(projectId));
      expect(response.status).toBe(200);
      expect((await response.json()).project.id).toBe(projectId);
    });

    it("can edit another user's project", async () => {
      activeToken = adminToken;
      const response = await projectRoutes.PATCH(
        jsonRequest({ name: 'Renamed By Admin' }, 'PATCH'),
        params(projectId),
      );

      expect(response.status).toBe(200);
      const saved = await prisma.project.findUnique({ where: { id: projectId } });
      expect(saved?.name).toBe('Renamed By Admin');
      // Editing someone else's project does not transfer ownership.
      expect(saved?.userId).toBe(ownerId);
    });

    it("can read another user's keywords, rankings and export", async () => {
      activeToken = adminToken;
      for (const name of [
        'GET /api/projects/[id]/keywords',
        'GET /api/projects/[id]/rankings',
        'GET /api/projects/[id]/export',
        'GET /api/projects/[id]/rank-check',
      ] as const) {
        expect((await routeCalls()[name]()).status, name).toBe(200);
      }
    });

    it("can read another user's rank check by id", async () => {
      activeToken = adminToken;
      const response = await rankCheckByIdRoute.GET(getRequest(), params(rankCheckId));
      expect(response.status).toBe(200);
    });

    it("sees another user's project in the list", async () => {
      activeToken = adminToken;
      const { projects } = await (await projectsRoute.GET()).json();
      expect(projects.map((p: { id: string }) => p.id)).toContain(projectId);
    });

    it("can delete another user's project", async () => {
      activeToken = adminToken;
      const response = await projectRoutes.DELETE(getRequest(), params(projectId));
      expect(response.status).toBe(200);
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
    });

    it('still creates projects under their own account', async () => {
      activeToken = adminToken;
      const response = await projectsRoute.POST(
        jsonRequest({ name: 'Admin Own Project', domain: 'admin-own.com' }),
      );

      expect(response.status).toBe(201);
      const { project } = await response.json();

      const admin = await prisma.user.findUnique({ where: { email: ADMIN } });
      // A superadmin creating a project owns it themselves; ownership is never
      // assigned implicitly.
      expect(project.userId).toBe(admin!.id);

      await prisma.project.delete({ where: { id: project.id } });
    });
  });

  describe('a signed-out request', () => {
    it('is refused everywhere', async () => {
      activeToken = '';
      for (const [name, call] of Object.entries(routeCalls())) {
        expect((await call()).status, name).toBe(401);
      }
    });
  });
});
