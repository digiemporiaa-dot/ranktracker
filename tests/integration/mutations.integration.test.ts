/**
 * Edit / delete routes against a real PostgreSQL database.
 *
 * The route handlers themselves are called — Zod parsing, the ownership check,
 * the running-check guard and the Prisma writes all run for real. Only
 * `next/headers` is stubbed, so a session cookie can be presented.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set:
 *   INTEGRATION_DATABASE_URL=postgresql://... npx vitest run tests/integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';

const INTEGRATION_URL = process.env.INTEGRATION_DATABASE_URL;
const describeIf = INTEGRATION_URL ? describe : describe.skip;

const SESSION_SECRET = 'integration-session-secret-long-enough-for-zod';

/** The cookie the stubbed `next/headers` will hand back. */
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

describeIf('project edit and delete routes (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let routes: typeof import('@/app/api/projects/[id]/route');
  let keywordRoutes: typeof import('@/app/api/projects/[id]/keywords/route');
  let bulkRoutes: typeof import('@/app/api/projects/[id]/keywords/bulk-delete/route');
  let clearRoutes: typeof import('@/app/api/projects/[id]/keywords/all/route');
  let rateLimits: typeof import('@/lib/rate-limit');

  let ownerId = '';
  let ownerToken = '';
  let strangerToken = '';
  let projectId = '';
  let strangerProjectId = '';
  let strangerKeywordId = '';

  const OWNER_EMAIL = 'mutations-owner@test.local';
  const STRANGER_EMAIL = 'mutations-stranger@test.local';

  async function issueSession(userId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    const tokenHash = createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
    await prisma.session.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
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

    routes = await import('@/app/api/projects/[id]/route');
    keywordRoutes = await import('@/app/api/projects/[id]/keywords/route');
    bulkRoutes = await import('@/app/api/projects/[id]/keywords/bulk-delete/route');
    clearRoutes = await import('@/app/api/projects/[id]/keywords/all/route');
    rateLimits = await import('@/lib/rate-limit');

    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, STRANGER_EMAIL] } } });

    const owner = await prisma.user.create({
      data: { email: OWNER_EMAIL, name: 'Owner', passwordHash: 'x' },
    });
    ownerId = owner.id;
    ownerToken = await issueSession(owner.id);

    const stranger = await prisma.user.create({
      data: { email: STRANGER_EMAIL, name: 'Stranger', passwordHash: 'x' },
    });
    strangerToken = await issueSession(stranger.id);

    const strangerProject = await prisma.project.create({
      data: { userId: stranger.id, name: 'Stranger Project', domain: 'stranger.com' },
    });
    strangerProjectId = strangerProject.id;
    const strangerKeyword = await prisma.keyword.create({
      data: { projectId: strangerProject.id, keyword: 'stranger keyword' },
    });
    strangerKeywordId = strangerKeyword.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: { email: { in: [OWNER_EMAIL, STRANGER_EMAIL] } },
      });
      await prisma.$disconnect();
    }
  });

  /** A fresh project with three keywords, each carrying ranking history. */
  beforeEach(async () => {
    rateLimits.__resetRateLimits();
    activeToken = ownerToken;

    await prisma.project.deleteMany({ where: { userId: ownerId } });

    const project = await prisma.project.create({
      data: { userId: ownerId, name: 'Wroffy India', domain: 'wroffy.com' },
    });
    projectId = project.id;

    const check = await prisma.rankCheck.create({
      data: { projectId, status: 'COMPLETED', totalKeywords: 3, completedKeywords: 3 },
    });

    for (const keyword of ['alpha', 'beta', 'gamma']) {
      const row = await prisma.keyword.create({ data: { projectId, keyword } });
      await prisma.ranking.create({
        data: { keywordId: row.id, rankCheckId: check.id, position: 5 },
      });
    }
  });

  const keywordIds = async () =>
    (await prisma.keyword.findMany({ where: { projectId }, select: { id: true } })).map(
      (k) => k.id,
    );

  // ---------- PATCH ----------

  describe('PATCH /api/projects/[id]', () => {
    it('updates the editable fields', async () => {
      const response = await routes.PATCH(
        jsonRequest({ name: 'Wroffy Global', country: 'US', device: 'MOBILE' }, 'PATCH'),
        params(projectId),
      );

      expect(response.status).toBe(200);
      const saved = await prisma.project.findUnique({ where: { id: projectId } });
      expect(saved).toMatchObject({
        name: 'Wroffy Global',
        country: 'US',
        device: 'MOBILE',
      });
    });

    it('never changes the domain, even if one is sent', async () => {
      await routes.PATCH(
        jsonRequest({ name: 'Renamed', domain: 'hijacked.com' }, 'PATCH'),
        params(projectId),
      );

      const saved = await prisma.project.findUnique({ where: { id: projectId } });
      expect(saved?.domain).toBe('wroffy.com');
    });

    it('leaves existing keywords on their own country / language / device', async () => {
      await routes.PATCH(jsonRequest({ country: 'US' }, 'PATCH'), params(projectId));

      const keywords = await prisma.keyword.findMany({ where: { projectId } });
      expect(keywords).toHaveLength(3);
      for (const keyword of keywords) expect(keyword.country).toBe('IN');
    });

    it('rejects an unknown country, language or device', async () => {
      for (const body of [{ country: 'ZZ' }, { language: 'fr' }, { device: 'TABLET' }]) {
        const response = await routes.PATCH(jsonRequest(body, 'PATCH'), params(projectId));
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('rejects an empty body', async () => {
      const response = await routes.PATCH(jsonRequest({}, 'PATCH'), params(projectId));
      expect(response.status).toBe(400);
    });

    it("returns 404 for another user's project, never 403", async () => {
      const response = await routes.PATCH(
        jsonRequest({ name: 'Taken over' }, 'PATCH'),
        params(strangerProjectId),
      );

      expect(response.status).toBe(404);
      const untouched = await prisma.project.findUnique({ where: { id: strangerProjectId } });
      expect(untouched?.name).toBe('Stranger Project');
    });

    it('returns 409 on a duplicate project name, not a 500', async () => {
      await prisma.project.create({
        data: { userId: ownerId, name: 'Already Taken', domain: 'other.com' },
      });

      const response = await routes.PATCH(
        jsonRequest({ name: 'Already Taken' }, 'PATCH'),
        params(projectId),
      );

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/already have a project with that name/i);
    });

    it('requires a session', async () => {
      activeToken = '';
      const response = await routes.PATCH(
        jsonRequest({ name: 'Anonymous' }, 'PATCH'),
        params(projectId),
      );
      expect(response.status).toBe(401);
    });
  });

  // ---------- DELETE project ----------

  describe('DELETE /api/projects/[id]', () => {
    it('removes the project with its keywords, rankings and rank checks', async () => {
      const response = await routes.DELETE(new Request('http://localhost'), params(projectId));
      expect(response.status).toBe(200);

      expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(0);
      expect(await prisma.rankCheck.count({ where: { projectId } })).toBe(0);
      expect(await prisma.ranking.count({ where: { keyword: { projectId } } })).toBe(0);
    });

    it("returns 404 for another user's project and deletes nothing", async () => {
      const response = await routes.DELETE(
        new Request('http://localhost'),
        params(strangerProjectId),
      );

      expect(response.status).toBe(404);
      expect(await prisma.project.count({ where: { id: strangerProjectId } })).toBe(1);
    });
  });

  // ---------- keyword deletes ----------

  describe('DELETE /api/projects/[id]/keywords', () => {
    it('deletes one keyword and its ranking history', async () => {
      const [first] = await keywordIds();

      const response = await keywordRoutes.DELETE(
        new Request(`http://localhost/x?keywordId=${first}`, { method: 'DELETE' }),
        params(projectId),
      );

      expect(response.status).toBe(200);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(2);
      expect(await prisma.ranking.count({ where: { keywordId: first } })).toBe(0);
    });

    it("ignores a keyword id from another user's project", async () => {
      const response = await keywordRoutes.DELETE(
        new Request(`http://localhost/x?keywordId=${strangerKeywordId}`, { method: 'DELETE' }),
        params(projectId),
      );

      expect(response.status).toBe(404);
      expect(await prisma.keyword.count({ where: { id: strangerKeywordId } })).toBe(1);
    });
  });

  describe('POST /api/projects/[id]/keywords/bulk-delete', () => {
    it('deletes the selected keywords', async () => {
      const ids = await keywordIds();

      const response = await bulkRoutes.POST(
        jsonRequest({ keywordIds: ids.slice(0, 2) }),
        params(projectId),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ deleted: 2, requested: 2 });
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(1);
    });

    it('ignores ids belonging to a different project', async () => {
      const ids = await keywordIds();

      const response = await bulkRoutes.POST(
        jsonRequest({ keywordIds: [ids[0], strangerKeywordId] }),
        params(projectId),
      );

      // Reported honestly as a partial result, and the other project is intact.
      expect(await response.json()).toMatchObject({ deleted: 1, requested: 2 });
      expect(await prisma.keyword.count({ where: { id: strangerKeywordId } })).toBe(1);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(2);
    });

    it('rejects an empty list', async () => {
      const response = await bulkRoutes.POST(jsonRequest({ keywordIds: [] }), params(projectId));
      expect(response.status).toBe(400);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
    });
  });

  describe('DELETE /api/projects/[id]/keywords/all', () => {
    it('clears every keyword and rank check when the name matches', async () => {
      const response = await clearRoutes.DELETE(
        jsonRequest({ confirm: 'Wroffy India' }, 'DELETE'),
        params(projectId),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ deleted: 3 });
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(0);
      expect(await prisma.rankCheck.count({ where: { projectId } })).toBe(0);
      // The project itself survives.
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);
    });

    it('deletes nothing and returns 400 when the confirm string is wrong', async () => {
      for (const confirm of ['wroffy india', 'Wroffy  India', 'something else']) {
        const response = await clearRoutes.DELETE(
          jsonRequest({ confirm }, 'DELETE'),
          params(projectId),
        );

        expect(response.status, confirm).toBe(400);
        expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
      }
    });

    it('returns 400 when confirm is missing entirely', async () => {
      const response = await clearRoutes.DELETE(jsonRequest({}, 'DELETE'), params(projectId));
      expect(response.status).toBe(400);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
    });
  });

  // ---------- running-check guard ----------

  describe('while a ranking check is in flight', () => {
    for (const status of ['RUNNING', 'PENDING'] as const) {
      describe(`status ${status}`, () => {
        beforeEach(async () => {
          await prisma.rankCheck.create({
            data: { projectId, status, totalKeywords: 3 },
          });
        });

        it('refuses to delete the project', async () => {
          const response = await routes.DELETE(
            new Request('http://localhost'),
            params(projectId),
          );
          expect(response.status).toBe(409);
          expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);
        });

        it('refuses to delete a single keyword', async () => {
          const [first] = await keywordIds();
          const response = await keywordRoutes.DELETE(
            new Request(`http://localhost/x?keywordId=${first}`, { method: 'DELETE' }),
            params(projectId),
          );
          expect(response.status).toBe(409);
          expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
        });

        it('refuses a bulk delete', async () => {
          const ids = await keywordIds();
          const response = await bulkRoutes.POST(
            jsonRequest({ keywordIds: ids }),
            params(projectId),
          );
          expect(response.status).toBe(409);
          expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
        });

        it('refuses clear-all', async () => {
          const response = await clearRoutes.DELETE(
            jsonRequest({ confirm: 'Wroffy India' }, 'DELETE'),
            params(projectId),
          );
          expect(response.status).toBe(409);
          expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
        });

        it('still allows a rename, which touches no ranking data', async () => {
          const response = await routes.PATCH(
            jsonRequest({ name: 'Renamed Mid-Check' }, 'PATCH'),
            params(projectId),
          );
          expect(response.status).toBe(200);
        });
      });
    }
  });

  // ---------- cross-user isolation on the new routes ----------

  describe('cross-user isolation', () => {
    beforeEach(() => {
      activeToken = strangerToken;
    });

    it("returns 404 on every destructive route for someone else's project", async () => {
      const attempts: [string, Promise<Response>][] = [
        ['PATCH', routes.PATCH(jsonRequest({ name: 'x' }, 'PATCH'), params(projectId))],
        ['DELETE project', routes.DELETE(new Request('http://localhost'), params(projectId))],
        [
          'bulk-delete',
          bulkRoutes.POST(jsonRequest({ keywordIds: ['anything'] }), params(projectId)),
        ],
        [
          'clear-all',
          clearRoutes.DELETE(jsonRequest({ confirm: 'Wroffy India' }, 'DELETE'), params(projectId)),
        ],
      ];

      for (const [label, pending] of attempts) {
        expect((await pending).status, label).toBe(404);
      }

      // Nothing was touched.
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
    });
  });
});
