/**
 * The shared account-creation module, against a real database.
 *
 * `createUser` is what both the create-superadmin CLI and (from phase 6) the
 * admin route call, so the guarantees asserted here — the default role, email
 * normalization, and that a password reset also signs the user out — are what
 * keeps those two paths from drifting apart.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const INTEGRATION_URL = process.env.INTEGRATION_DATABASE_URL;
const describeIf = INTEGRATION_URL ? describe : describe.skip;

describeIf('shared user creation (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let users: typeof import('@/lib/users');
  let auth: typeof import('@/lib/auth');

  const EMAILS = [
    'users-plain@test.local',
    'users-super@test.local',
    'users-reset@test.local',
    'users-inactive@test.local',
  ];

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  };

  beforeEach(async () => {
    if (!prisma) {
      process.env.DATABASE_URL = INTEGRATION_URL;
      process.env.SESSION_SECRET = 'integration-session-secret-long-enough-for-zod';
      vi.resetModules();
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient();
      users = await import('@/lib/users');
      auth = await import('@/lib/auth');
    }
    await cleanup();
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup();
      await prisma.$disconnect();
    }
  });

  it('defaults to EXECUTIVE when no role is given', async () => {
    // The admin route relies on this: it never passes a role, so a role in the
    // request body cannot promote anyone.
    const user = await users.createUser({
      email: 'users-plain@test.local',
      name: 'Plain',
      password: 'a-long-enough-password',
    });

    expect(user.role).toBe('EXECUTIVE');
    expect(user.isActive).toBe(true);
  });

  it('creates a SUPERADMIN only when one is asked for explicitly', async () => {
    const user = await users.createUser({
      email: 'users-super@test.local',
      name: 'Super',
      password: 'a-long-enough-password',
      role: 'SUPERADMIN',
    });

    expect(user.role).toBe('SUPERADMIN');
  });

  it('normalizes the email and trims the name', async () => {
    const user = await users.createUser({
      email: '  Users-Plain@Test.Local  ',
      name: '  Spaced Name  ',
      password: 'a-long-enough-password',
    });

    expect(user.email).toBe('users-plain@test.local');
    expect(user.name).toBe('Spaced Name');
  });

  it('stores a hash, never the password, and never returns it', async () => {
    const password = 'a-long-enough-password';
    const user = await users.createUser({
      email: 'users-plain@test.local',
      name: 'Plain',
      password,
    });

    expect(Object.keys(user)).not.toContain('passwordHash');

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe(password);
    expect(stored?.passwordHash).not.toContain(password);
    expect(await auth.verifyPassword(password, stored!.passwordHash)).toBe(true);
  });

  it('records who provisioned an account', async () => {
    const creator = await users.createUser({
      email: 'users-super@test.local',
      name: 'Super',
      password: 'a-long-enough-password',
      role: 'SUPERADMIN',
    });

    const made = await users.createUser({
      email: 'users-plain@test.local',
      name: 'Plain',
      password: 'a-long-enough-password',
      createdById: creator.id,
    });

    const stored = await prisma.user.findUnique({ where: { id: made.id } });
    expect(stored?.createdById).toBe(creator.id);
  });

  describe('setUserPassword', () => {
    it('replaces the hash and signs every session out', async () => {
      const user = await users.createUser({
        email: 'users-reset@test.local',
        name: 'Reset',
        password: 'the-original-password',
      });

      await prisma.session.createMany({
        data: [
          { userId: user.id, tokenHash: 'reset-hash-1', expiresAt: new Date(Date.now() + 60_000) },
          { userId: user.id, tokenHash: 'reset-hash-2', expiresAt: new Date(Date.now() + 60_000) },
        ],
      });
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

      await users.setUserPassword(user.id, 'the-replacement-password');

      const stored = await prisma.user.findUnique({ where: { id: user.id } });
      expect(await auth.verifyPassword('the-replacement-password', stored!.passwordHash)).toBe(true);
      expect(await auth.verifyPassword('the-original-password', stored!.passwordHash)).toBe(false);

      // A reset that leaves old sessions alive has not locked anyone out.
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  describe('activeSuperadminCount', () => {
    it('counts only superadmins who can still sign in', async () => {
      const before = await users.activeSuperadminCount();

      await users.createUser({
        email: 'users-super@test.local',
        name: 'Super',
        password: 'a-long-enough-password',
        role: 'SUPERADMIN',
      });
      expect(await users.activeSuperadminCount()).toBe(before + 1);

      const inactive = await users.createUser({
        email: 'users-inactive@test.local',
        name: 'Inactive',
        password: 'a-long-enough-password',
        role: 'SUPERADMIN',
      });
      await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });

      // A deactivated superadmin cannot administer anything, so it must not
      // count toward "is there still an administrator?".
      expect(await users.activeSuperadminCount()).toBe(before + 1);

      const executive = await users.createUser({
        email: 'users-plain@test.local',
        name: 'Plain',
        password: 'a-long-enough-password',
      });
      expect(executive.role).toBe('EXECUTIVE');
      expect(await users.activeSuperadminCount()).toBe(before + 1);
    });
  });
});
