import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { createSession, hashPassword } from '@/lib/auth';
import { clientKey, parseBody, route, ApiError } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { registerSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  return route('POST /api/auth/register', async ({ requestId }) => {
    const limit = rateLimit(`register:${clientKey(request)}`, 10, 60 * 15);
    if (!limit.allowed) {
      throw new ApiError(429, 'Too many attempts. Please try again shortly.');
    }

    const { name, email, password } = await parseBody(request, registerSchema);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, 'An account with that email already exists.');
    }

    const user = await prisma.user.create({
      data: { name, email, passwordHash: await hashPassword(password) },
      select: { id: true, email: true, name: true },
    });

    await createSession(user.id);
    logger.info('user registered', { requestId, userId: user.id });

    return NextResponse.json({ user }, { status: 201 });
  });
}
