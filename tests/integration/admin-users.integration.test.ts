/**
 * Admin user management, against a real database.
 *
 * The route handlers run for real — the superadmin guard, Zod, the safety
 * guards and the Prisma writes. Only `next/headers` is stubbed so a session
 * cookie can be presented.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describeIf('admin user management (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let usersRoute: typeof import('@/app/api/admin/users/route');
  let userRoute: typeof import('@/app/api/admin/users/[id]/route');
  let auth: typeof import('@/lib/auth');
  let rateLimits: typeof import('@/lib/rate-limit');

  const ADMIN = 'admin-super@test.local';
  const ADMIN2 = 'admin-super2@test.local';
  const EXEC = 'admin-exec@test.local';
  const RECIPIENT = 'admin-recipient@test.local';
  const CREATED = 'admin-created@test.local';
  const EMAILS = [ADMIN, ADMIN2, EXEC, RECIPIENT, CREATED];

  let adminId = '';
  let admin2Id = '';
  let execId = '';
  let recipientId = '';
  let adminToken = '';
  let execToken = '';

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

    vi.resetModules();
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    usersRoute = await import('@/app/api/admin/users/route');
    userRoute = await import('@/app/api/admin/users/[id]/route');
    auth = await import('@/lib/auth');
    rateLimits = await import('@/lib/rate-limit');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    rateLimits.__resetRateLimits();
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });

    // Two superadmins, so "last active superadmin" is not triggered by default.
    const admin = await prisma.user.create({
      data: { email: ADMIN, name: 'Admin', passwordHash: 'x', role: 'SUPERADMIN' },
    });
    const admin2 = await prisma.user.create({
      data: { email: ADMIN2, name: 'Admin Two', passwordHash: 'x', role: 'SUPERADMIN' },
    });
    const exec = await prisma.user.create({
      data: { email: EXEC, name: 'Exec', passwordHash: 'x', role: 'EXECUTIVE' },
    });
    const recipient = await prisma.user.create({
      data: { email: RECIPIENT, name: 'Recipient', passwordHash: 'x', role: 'EXECUTIVE' },
    });

    adminId = admin.id;
    admin2Id = admin2.id;
    execId = exec.id;
    recipientId = recipient.id;

    adminToken = await issueSession(admin.id);
    execToken = await issueSession(exec.id);
    activeToken = adminToken;
  });

  // ---------- discoverability ----------

  describe('an executive cannot reach the admin surface', () => {
    const calls = () => ({
      'GET /api/admin/users': () => usersRoute.GET(),
      'POST /api/admin/users': () =>
        usersRoute.POST(
          jsonRequest({ email: CREATED, name: 'Sneaky', password: 'a-long-password' }),
        ),
      'PATCH /api/admin/users/[id]': () =>
        userRoute.PATCH(jsonRequest({ name: 'Renamed' }, 'PATCH'), params(execId)),
      'DELETE /api/admin/users/[id]': () =>
        userRoute.DELETE(
          new Request('http://localhost/x?onDelete=purge', { method: 'DELETE' }),
          params(recipientId),
        ),
    });

    for (const name of Object.keys(calls())) {
      it(`${name} returns 404, not 403`, async () => {
        activeToken = execToken;
        const response = await calls()[name as keyof ReturnType<typeof calls>]();
        expect(response.status).toBe(404);
      });
    }

    it('changes nothing', async () => {
      activeToken = execToken;
      for (const call of Object.values(calls())) await call();

      expect(await prisma.user.count({ where: { email: CREATED } })).toBe(0);
      expect((await prisma.user.findUnique({ where: { id: execId } }))?.name).toBe('Exec');
      expect(await prisma.user.count({ where: { id: recipientId } })).toBe(1);
    });

    it('refuses a signed-out caller too', async () => {
      activeToken = '';
      expect((await usersRoute.GET()).status).toBe(401);
    });
  });

  // ---------- create ----------

  describe('POST /api/admin/users', () => {
    it('creates an executive and records who provisioned it', async () => {
      const response = await usersRoute.POST(
        jsonRequest({ email: CREATED, name: 'New Exec', password: 'a-long-password' }),
      );

      expect(response.status).toBe(201);
      const { user } = await response.json();
      expect(user.role).toBe('EXECUTIVE');

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(stored?.createdById).toBe(adminId);
      expect(stored?.isActive).toBe(true);
    });

    it('still creates an EXECUTIVE when the body asks for SUPERADMIN', async () => {
      const response = await usersRoute.POST(
        jsonRequest({
          email: CREATED,
          name: 'Would-be admin',
          password: 'a-long-password',
          role: 'SUPERADMIN',
        }),
      );

      expect(response.status).toBe(201);
      // The role is fixed server-side; a role in the body is simply not read.
      expect((await response.json()).user.role).toBe('EXECUTIVE');
    });

    it('rejects a duplicate email with 409', async () => {
      await usersRoute.POST(
        jsonRequest({ email: CREATED, name: 'First', password: 'a-long-password' }),
      );
      const response = await usersRoute.POST(
        jsonRequest({ email: CREATED, name: 'Second', password: 'a-long-password' }),
      );

      expect(response.status).toBe(409);
      expect(await prisma.user.count({ where: { email: CREATED } })).toBe(1);
    });

    it('rejects a short password and a bad email', async () => {
      expect(
        (await usersRoute.POST(jsonRequest({ email: CREATED, name: 'X', password: 'short' })))
          .status,
      ).toBe(400);
      expect(
        (
          await usersRoute.POST(
            jsonRequest({ email: 'not-an-email', name: 'X', password: 'a-long-password' }),
          )
        ).status,
      ).toBe(400);
      expect(await prisma.user.count({ where: { email: CREATED } })).toBe(0);
    });

    it('the created account can sign in', async () => {
      const password = 'a-long-enough-password';
      await usersRoute.POST(jsonRequest({ email: CREATED, name: 'New Exec', password }));

      const stored = await prisma.user.findUnique({ where: { email: CREATED } });
      expect(await auth.verifyPassword(password, stored!.passwordHash)).toBe(true);
    });
  });

  // ---------- list ----------

  describe('GET /api/admin/users', () => {
    it('lists every user with a project count, and no password hashes', async () => {
      await prisma.project.create({
        data: { userId: execId, name: 'Exec Project', domain: 'exec.com' },
      });

      const { users } = await (await usersRoute.GET()).json();
      const emails = users.map((u: { email: string }) => u.email);
      expect(emails).toEqual(expect.arrayContaining([ADMIN, ADMIN2, EXEC, RECIPIENT]));

      const exec = users.find((u: { email: string }) => u.email === EXEC);
      expect(exec._count.projects).toBe(1);

      for (const user of users) expect(Object.keys(user)).not.toContain('passwordHash');
    });
  });

  // ---------- update ----------

  describe('PATCH /api/admin/users/[id]', () => {
    it('renames without signing the user out', async () => {
      await issueSession(execId);
      const before = await prisma.session.count({ where: { userId: execId } });

      const response = await userRoute.PATCH(
        jsonRequest({ name: 'Renamed Exec' }, 'PATCH'),
        params(execId),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).user.name).toBe('Renamed Exec');
      expect(await prisma.session.count({ where: { userId: execId } })).toBe(before);
    });

    it('deactivating deletes their sessions', async () => {
      await issueSession(execId);
      await issueSession(execId);
      expect(await prisma.session.count({ where: { userId: execId } })).toBeGreaterThan(1);

      const response = await userRoute.PATCH(
        jsonRequest({ isActive: false }, 'PATCH'),
        params(execId),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).user.isActive).toBe(false);
      expect(await prisma.session.count({ where: { userId: execId } })).toBe(0);
    });

    it('resetting a password signs them out and changes the hash', async () => {
      await issueSession(execId);
      const before = await prisma.user.findUnique({ where: { id: execId } });

      const response = await userRoute.PATCH(
        jsonRequest({ password: 'a-brand-new-password' }, 'PATCH'),
        params(execId),
      );

      expect(response.status).toBe(200);
      const after = await prisma.user.findUnique({ where: { id: execId } });
      expect(after?.passwordHash).not.toBe(before?.passwordHash);
      expect(await auth.verifyPassword('a-brand-new-password', after!.passwordHash)).toBe(true);
      expect(await prisma.session.count({ where: { userId: execId } })).toBe(0);
    });

    it('never returns or stores the password itself', async () => {
      const response = await userRoute.PATCH(
        jsonRequest({ password: 'a-brand-new-password' }, 'PATCH'),
        params(execId),
      );
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain('a-brand-new-password');
    });

    it('ignores a role in the body — no request can promote anyone', async () => {
      const response = await userRoute.PATCH(
        jsonRequest({ name: 'Still An Exec', role: 'SUPERADMIN' }, 'PATCH'),
        params(execId),
      );

      expect(response.status).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: execId } }))?.role).toBe('EXECUTIVE');
    });

    it('rejects an empty body', async () => {
      expect((await userRoute.PATCH(jsonRequest({}, 'PATCH'), params(execId))).status).toBe(400);
    });

    it('404s for a user that does not exist', async () => {
      expect(
        (await userRoute.PATCH(jsonRequest({ name: 'X' }, 'PATCH'), params('no-such-user'))).status,
      ).toBe(404);
    });
  });

  // ---------- self-protection ----------

  describe('a superadmin cannot lock themselves out', () => {
    it('cannot deactivate themselves', async () => {
      const response = await userRoute.PATCH(
        jsonRequest({ isActive: false }, 'PATCH'),
        params(adminId),
      );

      expect(response.status).toBe(400);
      expect((await prisma.user.findUnique({ where: { id: adminId } }))?.isActive).toBe(true);
    });

    it('cannot delete themselves', async () => {
      const response = await userRoute.DELETE(
        new Request('http://localhost/x?onDelete=purge', { method: 'DELETE' }),
        params(adminId),
      );

      expect(response.status).toBe(400);
      expect(await prisma.user.count({ where: { id: adminId } })).toBe(1);
    });
  });

  describe('the last active superadmin is protected', () => {
    // The shared database may hold other superadmins, so park them for the
    // duration of this block: the guard is about how many are *active*.
    let parked: string[] = [];

    beforeEach(async () => {
      const others = await prisma.user.findMany({
        where: {
          role: 'SUPERADMIN',
          isActive: true,
          email: { notIn: [ADMIN, ADMIN2] },
        },
        select: { id: true },
      });
      parked = others.map((u) => u.id);
      if (parked.length > 0) {
        await prisma.user.updateMany({ where: { id: { in: parked } }, data: { isActive: false } });
      }
    });

    afterEach(async () => {
      if (parked.length > 0) {
        await prisma.user.updateMany({ where: { id: { in: parked } }, data: { isActive: true } });
        parked = [];
      }
    });

    it('allows removing one superadmin while another is still active', async () => {
      // Two are active here, so the guard must not fire.
      expect(await prisma.user.count({ where: { role: 'SUPERADMIN', isActive: true } })).toBe(2);

      const response = await userRoute.PATCH(
        jsonRequest({ isActive: false }, 'PATCH'),
        params(admin2Id),
      );

      expect(response.status).toBe(200);
      expect(await prisma.user.count({ where: { role: 'SUPERADMIN', isActive: true } })).toBe(1);
    });

    it('refuses to deactivate the only one left', async () => {
      await prisma.user.update({ where: { id: admin2Id }, data: { isActive: false } });
      expect(await prisma.user.count({ where: { role: 'SUPERADMIN', isActive: true } })).toBe(1);

      const response = await userRoute.PATCH(
        jsonRequest({ isActive: false }, 'PATCH'),
        params(adminId),
      );

      expect(response.status).toBe(400);
      expect((await prisma.user.findUnique({ where: { id: adminId } }))?.isActive).toBe(true);
      expect(await prisma.user.count({ where: { role: 'SUPERADMIN', isActive: true } })).toBe(1);
    });

    it('refuses to delete the only one left', async () => {
      await prisma.user.update({ where: { id: admin2Id }, data: { isActive: false } });

      const response = await userRoute.DELETE(
        new Request('http://localhost/x?onDelete=purge', { method: 'DELETE' }),
        params(adminId),
      );

      expect(response.status).toBe(400);
      expect(await prisma.user.count({ where: { id: adminId } })).toBe(1);
    });

    it('leaves the instance with an administrator after any allowed change', async () => {
      // Whatever the admin route permits, at least one active superadmin must
      // remain — that is the property the guard exists to hold.
      await userRoute.PATCH(jsonRequest({ isActive: false }, 'PATCH'), params(admin2Id));
      await userRoute.PATCH(jsonRequest({ isActive: false }, 'PATCH'), params(adminId));
      await userRoute.DELETE(
        new Request('http://localhost/x?onDelete=purge', { method: 'DELETE' }),
        params(adminId),
      );

      expect(
        await prisma.user.count({ where: { role: 'SUPERADMIN', isActive: true } }),
      ).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------- delete ----------

  describe('DELETE /api/admin/users/[id]', () => {
    beforeEach(async () => {
      // The executive owns a project with a keyword, a ranking and a check.
      const project = await prisma.project.create({
        data: { userId: execId, name: 'Exec Project', domain: 'exec.com' },
      });
      const keyword = await prisma.keyword.create({
        data: { projectId: project.id, keyword: 'exec keyword' },
      });
      const check = await prisma.rankCheck.create({
        data: { projectId: project.id, status: 'COMPLETED', totalKeywords: 1 },
      });
      await prisma.ranking.create({
        data: { keywordId: keyword.id, rankCheckId: check.id, position: 7, device: 'DESKTOP', locationCode: 2356, googleDomain: 'google.com' },
      });
    });

    it('refuses a bare delete with 400 and removes nothing', async () => {
      const response = await userRoute.DELETE(
        new Request('http://localhost/x', { method: 'DELETE' }),
        params(execId),
      );

      expect(response.status).toBe(400);
      const { error } = await response.json();
      // The message must name both ways out.
      expect(error).toMatch(/reassign/i);
      expect(error).toMatch(/purge/i);

      expect(await prisma.user.count({ where: { id: execId } })).toBe(1);
      expect(await prisma.project.count({ where: { userId: execId } })).toBe(1);
      expect(await prisma.ranking.count()).toBeGreaterThan(0);
    });

    it('refuses an unknown onDelete value', async () => {
      const response = await userRoute.DELETE(
        new Request('http://localhost/x?onDelete=whatever', { method: 'DELETE' }),
        params(execId),
      );
      expect(response.status).toBe(400);
      expect(await prisma.user.count({ where: { id: execId } })).toBe(1);
    });

    it('reassign moves the projects and preserves every ranking row', async () => {
      const rankingsBefore = await prisma.ranking.count({
        where: { keyword: { project: { userId: execId } } },
      });
      expect(rankingsBefore).toBe(1);

      const response = await userRoute.DELETE(
        new Request(`http://localhost/x?onDelete=reassign&toUserId=${recipientId}`, {
          method: 'DELETE',
        }),
        params(execId),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ onDelete: 'reassign', projectsMoved: 1 });

      expect(await prisma.user.count({ where: { id: execId } })).toBe(0);
      expect(await prisma.project.count({ where: { userId: recipientId } })).toBe(1);

      // The history moved intact — this is the whole point of reassign.
      expect(
        await prisma.ranking.count({ where: { keyword: { project: { userId: recipientId } } } }),
      ).toBe(1);
      expect(
        await prisma.keyword.count({ where: { project: { userId: recipientId } } }),
      ).toBe(1);
    });

    it('refuses to reassign onto a name the recipient already uses', async () => {
      await prisma.project.create({
        data: { userId: recipientId, name: 'Exec Project', domain: 'other.com' },
      });

      const response = await userRoute.DELETE(
        new Request(`http://localhost/x?onDelete=reassign&toUserId=${recipientId}`, {
          method: 'DELETE',
        }),
        params(execId),
      );

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/Exec Project/);
      // Nothing moved, nothing deleted.
      expect(await prisma.user.count({ where: { id: execId } })).toBe(1);
      expect(await prisma.project.count({ where: { userId: execId } })).toBe(1);
    });

    it('refuses an unknown or inactive recipient', async () => {
      expect(
        (
          await userRoute.DELETE(
            new Request('http://localhost/x?onDelete=reassign&toUserId=nobody', {
              method: 'DELETE',
            }),
            params(execId),
          )
        ).status,
      ).toBe(400);

      await prisma.user.update({ where: { id: recipientId }, data: { isActive: false } });
      expect(
        (
          await userRoute.DELETE(
            new Request(`http://localhost/x?onDelete=reassign&toUserId=${recipientId}`, {
              method: 'DELETE',
            }),
            params(execId),
          )
        ).status,
      ).toBe(400);

      expect(await prisma.user.count({ where: { id: execId } })).toBe(1);
    });

    it('purge removes the account and all of its data', async () => {
      const response = await userRoute.DELETE(
        new Request('http://localhost/x?onDelete=purge', { method: 'DELETE' }),
        params(execId),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ onDelete: 'purge', projectsPurged: 1 });

      expect(await prisma.user.count({ where: { id: execId } })).toBe(0);
      expect(await prisma.project.count({ where: { userId: execId } })).toBe(0);
      expect(await prisma.keyword.count({ where: { project: { userId: execId } } })).toBe(0);

      // The recipient's data is untouched.
      expect(await prisma.user.count({ where: { id: recipientId } })).toBe(1);
    });
  });
});
