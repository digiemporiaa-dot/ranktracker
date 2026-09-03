/**
 * Session lookup, against a real database.
 *
 * The role has to come from the database on every request. If it came from the
 * cookie, anyone could hand themselves SUPERADMIN by editing it — so these
 * tests check both that the role is carried, and that the cookie holds nothing
 * but an opaque token.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

describeIf('session carries role and active flag (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let auth: typeof import('@/lib/auth');

  const SUPER_EMAIL = 'session-super@test.local';
  const EXEC_EMAIL = 'session-exec@test.local';
  const EMAILS = [SUPER_EMAIL, EXEC_EMAIL];

  /** Issue a session the same way createSession does, and return the raw token. */
  async function issueSession(userId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    const tokenHash = createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
    await prisma.session.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return token;
  }

  beforeEach(async () => {
    if (!prisma) {
      process.env.DATABASE_URL = INTEGRATION_URL;
      process.env.SESSION_SECRET = SESSION_SECRET;
      vi.resetModules();
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient();
      auth = await import('@/lib/auth');
    }

    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    activeToken = '';
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
      await prisma.$disconnect();
    }
  });

  const makeUser = (email: string, role: 'SUPERADMIN' | 'EXECUTIVE') =>
    prisma.user.create({
      data: { email, name: email, passwordHash: 'not-used', role },
    });

  it('reports the role stored on the user', async () => {
    const superadmin = await makeUser(SUPER_EMAIL, 'SUPERADMIN');
    activeToken = await issueSession(superadmin.id);

    const resolved = await auth.getCurrentUser();
    expect(resolved).toMatchObject({ id: superadmin.id, role: 'SUPERADMIN', isActive: true });
    expect(auth.isSuperadmin(resolved)).toBe(true);
  });

  it('reports an executive as an executive', async () => {
    const executive = await makeUser(EXEC_EMAIL, 'EXECUTIVE');
    activeToken = await issueSession(executive.id);

    const resolved = await auth.getCurrentUser();
    expect(resolved?.role).toBe('EXECUTIVE');
    expect(auth.isSuperadmin(resolved)).toBe(false);
  });

  it('never exposes the password hash on the session user', async () => {
    const executive = await makeUser(EXEC_EMAIL, 'EXECUTIVE');
    activeToken = await issueSession(executive.id);

    const resolved = await auth.getCurrentUser();
    expect(Object.keys(resolved ?? {})).not.toContain('passwordHash');
  });

  it('picks up a role change on the next request, without a new sign-in', async () => {
    const user = await makeUser(EXEC_EMAIL, 'EXECUTIVE');
    activeToken = await issueSession(user.id);

    expect((await auth.getCurrentUser())?.role).toBe('EXECUTIVE');

    await prisma.user.update({ where: { id: user.id }, data: { role: 'SUPERADMIN' } });

    // The role is read from the database each time, not cached in the cookie.
    expect((await auth.getCurrentUser())?.role).toBe('SUPERADMIN');
  });

  it('carries nothing but an opaque token in the cookie', async () => {
    const superadmin = await makeUser(SUPER_EMAIL, 'SUPERADMIN');
    const token = await issueSession(superadmin.id);

    // Whatever the cookie holds, it must not name the role, the user or the id.
    expect(token).not.toMatch(/SUPERADMIN|EXECUTIVE/i);
    expect(token).not.toContain(superadmin.id);
    expect(token).not.toContain(SUPER_EMAIL);

    // And the database stores a hash of it, not the token itself.
    const stored = await prisma.session.findFirst({ where: { userId: superadmin.id } });
    expect(stored?.tokenHash).not.toBe(token);
  });

  describe('deactivated accounts', () => {
    it('rejects the session on the very next request', async () => {
      const user = await makeUser(EXEC_EMAIL, 'EXECUTIVE');
      activeToken = await issueSession(user.id);

      expect(await auth.getCurrentUser()).not.toBeNull();

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      expect(await auth.getCurrentUser()).toBeNull();
    });

    it('clears every session that user still holds', async () => {
      const user = await makeUser(EXEC_EMAIL, 'EXECUTIVE');
      const first = await issueSession(user.id);
      await issueSession(user.id);
      await issueSession(user.id);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(3);

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      activeToken = first;
      expect(await auth.getCurrentUser()).toBeNull();

      // One rejected request takes the rest of that user's sessions with it,
      // so a deactivation cannot be outlived by a second browser.
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it('rejects a deactivated superadmin too', async () => {
      const user = await makeUser(SUPER_EMAIL, 'SUPERADMIN');
      activeToken = await issueSession(user.id);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      expect(await auth.getCurrentUser()).toBeNull();
    });

    it('lets a reactivated user sign in again', async () => {
      const user = await makeUser(EXEC_EMAIL, 'EXECUTIVE');
      activeToken = await issueSession(user.id);

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      expect(await auth.getCurrentUser()).toBeNull();

      await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });

      // The old sessions are gone, so a fresh one is required.
      activeToken = await issueSession(user.id);
      expect((await auth.getCurrentUser())?.isActive).toBe(true);
    });
  });

  describe('signing in', () => {
    it('refuses a deactivated account, with the same message as a wrong password', async () => {
      const { hashPassword } = await import('@/lib/auth');
      const password = 'a-long-enough-password';
      const user = await prisma.user.create({
        data: {
          email: EXEC_EMAIL,
          name: 'Exec',
          passwordHash: await hashPassword(password),
          role: 'EXECUTIVE',
          isActive: false,
        },
      });

      const login = await import('@/app/api/auth/login/route');
      const response = await login.POST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: EXEC_EMAIL, password }),
        }),
      );

      expect(response.status).toBe(401);
      // Same wording as a wrong password, so the response cannot be used to
      // discover which accounts exist and are switched off.
      expect((await response.json()).error).toBe('Incorrect email or password.');

      // And no session was handed out.
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it('lets the same account in once it is reactivated', async () => {
      const { hashPassword } = await import('@/lib/auth');
      const password = 'a-long-enough-password';
      const user = await prisma.user.create({
        data: {
          email: EXEC_EMAIL,
          name: 'Exec',
          passwordHash: await hashPassword(password),
          role: 'EXECUTIVE',
          isActive: true,
        },
      });

      const login = await import('@/app/api/auth/login/route');
      const response = await login.POST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: EXEC_EMAIL, password }),
        }),
      );

      expect(response.status).toBe(200);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  it('still rejects an expired session', async () => {
    const user = await makeUser(EXEC_EMAIL, 'EXECUTIVE');
    const token = randomBytes(24).toString('base64url');
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createHmac('sha256', SESSION_SECRET).update(token).digest('hex'),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    activeToken = token;
    expect(await auth.getCurrentUser()).toBeNull();
  });

  it('returns null when there is no cookie at all', async () => {
    activeToken = '';
    expect(await auth.getCurrentUser()).toBeNull();
  });
});
