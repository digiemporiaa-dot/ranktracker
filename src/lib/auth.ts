import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';

import { prisma } from '@/lib/db';
import { env, isProduction } from '@/lib/env';
import { logger } from '@/lib/logger';

export const SESSION_COOKIE = 'ort_session';
const SESSION_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * The raw session token lives only in the cookie. The database stores an
 * HMAC of it keyed by SESSION_SECRET, so a database dump alone cannot be
 * replayed as a valid session.
 */
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch((error) => logger.warn('session delete failed', { error }));
  }

  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: 0,
  });
}

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'isDemo'>;

/** Resolve the signed-in user, or null. Never throws. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, name: true, isDemo: true } } },
    });

    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }

    return session.user;
  } catch (error) {
    logger.warn('session lookup failed', { error });
    return null;
  }
}

/** Remove expired sessions. Safe to call opportunistically. */
export async function pruneSessions(): Promise<void> {
  await prisma.session
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((error) => logger.warn('session prune failed', { error }));
}

/** Constant-time string comparison for tokens supplied by a client. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
