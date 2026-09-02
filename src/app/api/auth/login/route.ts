import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { createSession, verifyPassword } from '@/lib/auth';
import { ApiError, clientKey, parseBody, route } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { loginSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  return route('POST /api/auth/login', async ({ requestId }) => {
    const limit = rateLimit(`login:${clientKey(request)}`, 10, 60 * 15);
    if (!limit.allowed) {
      throw new ApiError(429, 'Too many sign-in attempts. Please try again shortly.');
    }

    const { email, password } = await parseBody(request, loginSchema);
    const user = await prisma.user.findUnique({ where: { email } });

    // The same message either way, so the response cannot be used to discover
    // which email addresses have accounts.
    const invalid = new ApiError(401, 'Incorrect email or password.');

    if (!user) {
      // Spend comparable time so a missing user is not measurably faster.
      await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
      throw invalid;
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      logger.warn('failed sign-in', { requestId, userId: user.id });
      throw invalid;
    }

    await createSession(user.id);
    logger.info('user signed in', { requestId, userId: user.id });

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    });
  });
}
