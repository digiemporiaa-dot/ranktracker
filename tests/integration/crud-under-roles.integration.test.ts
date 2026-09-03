/**
 * The CRUD spec, re-verified under roles.
 *
 * The edit/delete features were built before roles existed. Every one of them
 * now goes through the role-aware ownership check, so this file asserts the
 * whole CRUD spec still holds — and adds what roles introduced: a superadmin
 * operating on someone else's project, and the running-check guard applying to
 * them just as it does to the owner.
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

describeIf('CRUD under roles (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let projectRoutes: typeof import('@/app/api/projects/[id]/route');
  let keywordRoutes: typeof import('@/app/api/projects/[id]/keywords/route');
  let bulkRoute: typeof import('@/app/api/projects/[id]/keywords/bulk-delete/route');
  let clearRoute: typeof import('@/app/api/projects/[id]/keywords/all/route');
  let rateLimits: typeof import('@/lib/rate-limit');

  const OWNER = 'crud-owner@test.local';
  const ADMIN = 'crud-admin@test.local';
  const EMAILS = [OWNER, ADMIN];

  const PROJECT_NAME = 'Crud Project';

  let ownerId = '';
  let ownerToken = '';
  let adminToken = '';
  let projectId = '';

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
    keywordRoutes = await import('@/app/api/projects/[id]/keywords/route');
    bulkRoute = await import('@/app/api/projects/[id]/keywords/bulk-delete/route');
    clearRoute = await import('@/app/api/projects/[id]/keywords/all/route');
    rateLimits = await import('@/lib/rate-limit');

    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });

    const owner = await prisma.user.create({
      data: { email: OWNER, name: 'Owner', passwordHash: 'x', role: 'EXECUTIVE' },
    });
    const admin = await prisma.user.create({
      data: { email: ADMIN, name: 'Admin', passwordHash: 'x', role: 'SUPERADMIN' },
    });

    ownerId = owner.id;
    ownerToken = await issueSession(owner.id);
    adminToken = await issueSession(admin.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
      await prisma.$disconnect();
    }
  });

  /** The executive's project: three keywords, each with ranking history. */
  beforeEach(async () => {
    rateLimits.__resetRateLimits();
    activeToken = ownerToken;

    await prisma.project.deleteMany({ where: { userId: ownerId } });

    const project = await prisma.project.create({
      data: { userId: ownerId, name: PROJECT_NAME, domain: 'crud.com' },
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

  // ---------- the CRUD spec, still holding ----------

  describe('project edit', () => {
    it('changes the editable fields', async () => {
      const response = await projectRoutes.PATCH(
        jsonRequest({ name: 'Renamed', country: 'US', device: 'MOBILE' }, 'PATCH'),
        params(projectId),
      );

      expect(response.status).toBe(200);
      expect(await prisma.project.findUnique({ where: { id: projectId } })).toMatchObject({
        name: 'Renamed',
        country: 'US',
        device: 'MOBILE',
      });
    });

    it('never changes the domain', async () => {
      await projectRoutes.PATCH(
        jsonRequest({ name: 'Renamed', domain: 'hijacked.com' }, 'PATCH'),
        params(projectId),
      );
      expect((await prisma.project.findUnique({ where: { id: projectId } }))?.domain).toBe(
        'crud.com',
      );
    });

    it('leaves existing keywords on their own locale', async () => {
      await projectRoutes.PATCH(jsonRequest({ country: 'US' }, 'PATCH'), params(projectId));
      const keywords = await prisma.keyword.findMany({ where: { projectId } });
      for (const keyword of keywords) expect(keyword.country).toBe('IN');
    });

    it('rejects an unknown country, language or device', async () => {
      for (const body of [{ country: 'ZZ' }, { language: 'fr' }, { device: 'TABLET' }]) {
        expect(
          (await projectRoutes.PATCH(jsonRequest(body, 'PATCH'), params(projectId))).status,
        ).toBe(400);
      }
    });

    it('returns 409 on a duplicate name, not 500', async () => {
      await prisma.project.create({
        data: { userId: ownerId, name: 'Taken', domain: 'taken.com' },
      });
      const response = await projectRoutes.PATCH(
        jsonRequest({ name: 'Taken' }, 'PATCH'),
        params(projectId),
      );
      expect(response.status).toBe(409);
    });
  });

  describe('deletes', () => {
    it('deleting the project removes keywords, rankings and checks', async () => {
      expect((await projectRoutes.DELETE(new Request('http://x'), params(projectId))).status).toBe(
        200,
      );
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(0);
      expect(await prisma.rankCheck.count({ where: { projectId } })).toBe(0);
      expect(await prisma.ranking.count({ where: { keyword: { projectId } } })).toBe(0);
    });

    it('deleting one keyword takes its history with it', async () => {
      const [first] = await keywordIds();
      const response = await keywordRoutes.DELETE(
        new Request(`http://x?keywordId=${first}`, { method: 'DELETE' }),
        params(projectId),
      );
      expect(response.status).toBe(200);
      expect(await prisma.ranking.count({ where: { keywordId: first } })).toBe(0);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(2);
    });

    it('bulk delete ignores ids from another project', async () => {
      const ids = await keywordIds();
      const foreign = await prisma.project.create({
        data: { userId: ownerId, name: 'Elsewhere', domain: 'elsewhere.com' },
      });
      const foreignKeyword = await prisma.keyword.create({
        data: { projectId: foreign.id, keyword: 'not mine' },
      });

      const response = await bulkRoute.POST(
        jsonRequest({ keywordIds: [ids[0], foreignKeyword.id] }),
        params(projectId),
      );

      expect(await response.json()).toMatchObject({ deleted: 1, requested: 2 });
      expect(await prisma.keyword.count({ where: { id: foreignKeyword.id } })).toBe(1);
    });

    it('clear-all with a wrong confirm string deletes nothing', async () => {
      const response = await clearRoute.DELETE(
        jsonRequest({ confirm: 'wrong name' }, 'DELETE'),
        params(projectId),
      );
      expect(response.status).toBe(400);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
    });

    it('clear-all with the right name removes keywords and checks, keeping the project', async () => {
      const response = await clearRoute.DELETE(
        jsonRequest({ confirm: PROJECT_NAME }, 'DELETE'),
        params(projectId),
      );
      expect(response.status).toBe(200);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(0);
      expect(await prisma.rankCheck.count({ where: { projectId } })).toBe(0);
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);
    });
  });

  // ---------- what roles added ----------

  describe("a superadmin can run every CRUD operation on someone else's project", () => {
    beforeEach(() => {
      activeToken = adminToken;
    });

    it('edits it without taking ownership', async () => {
      const response = await projectRoutes.PATCH(
        jsonRequest({ name: 'Edited By Admin' }, 'PATCH'),
        params(projectId),
      );

      expect(response.status).toBe(200);
      const saved = await prisma.project.findUnique({ where: { id: projectId } });
      expect(saved?.name).toBe('Edited By Admin');
      expect(saved?.userId).toBe(ownerId);
    });

    it('deletes a single keyword', async () => {
      const [first] = await keywordIds();
      const response = await keywordRoutes.DELETE(
        new Request(`http://x?keywordId=${first}`, { method: 'DELETE' }),
        params(projectId),
      );
      expect(response.status).toBe(200);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(2);
    });

    it('bulk deletes', async () => {
      const ids = await keywordIds();
      const response = await bulkRoute.POST(
        jsonRequest({ keywordIds: ids.slice(0, 2) }),
        params(projectId),
      );
      expect(response.status).toBe(200);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(1);
    });

    it("clears all keywords, using the project's own name as the confirmation", async () => {
      const response = await clearRoute.DELETE(
        jsonRequest({ confirm: PROJECT_NAME }, 'DELETE'),
        params(projectId),
      );
      expect(response.status).toBe(200);
      expect(await prisma.keyword.count({ where: { projectId } })).toBe(0);
    });

    it('deletes the whole project', async () => {
      const response = await projectRoutes.DELETE(new Request('http://x'), params(projectId));
      expect(response.status).toBe(200);
      expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
    });
  });

  describe('the running-check guard applies to everyone', () => {
    for (const status of ['RUNNING', 'PENDING'] as const) {
      for (const who of ['owner', 'superadmin'] as const) {
        describe(`${who}, check ${status}`, () => {
          beforeEach(async () => {
            activeToken = who === 'owner' ? ownerToken : adminToken;
            await prisma.rankCheck.create({
              data: { projectId, status, totalKeywords: 3 },
            });
          });

          it('refuses every destructive route with 409', async () => {
            const ids = await keywordIds();

            const attempts: [string, Response][] = [
              [
                'delete project',
                await projectRoutes.DELETE(new Request('http://x'), params(projectId)),
              ],
              [
                'delete keyword',
                await keywordRoutes.DELETE(
                  new Request(`http://x?keywordId=${ids[0]}`, { method: 'DELETE' }),
                  params(projectId),
                ),
              ],
              [
                'bulk delete',
                await bulkRoute.POST(jsonRequest({ keywordIds: ids }), params(projectId)),
              ],
              [
                'clear all',
                await clearRoute.DELETE(
                  jsonRequest({ confirm: PROJECT_NAME }, 'DELETE'),
                  params(projectId),
                ),
              ],
            ];

            for (const [label, response] of attempts) {
              expect(response.status, label).toBe(409);
            }

            // Nothing was removed.
            expect(await prisma.project.count({ where: { id: projectId } })).toBe(1);
            expect(await prisma.keyword.count({ where: { projectId } })).toBe(3);
          });

          it('still allows a rename, which touches no ranking data', async () => {
            const response = await projectRoutes.PATCH(
              jsonRequest({ name: 'Renamed Mid-Check' }, 'PATCH'),
              params(projectId),
            );
            expect(response.status).toBe(200);
          });
        });
      }
    }
  });
});
