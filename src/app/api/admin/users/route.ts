import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { ApiError, parseBody, requireSuperadmin, route } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { createUserSchema } from '@/lib/validation';
import { createUser, normalizeEmail, USER_SELECT } from '@/lib/users';
import { logger } from '@/lib/logger';

const CREATES_PER_WINDOW = 20;
const WINDOW_SECONDS = 60 * 10;

/** Every user, with enough context for the admin table. */
export async function GET() {
  return route('GET /api/admin/users', async () => {
    await requireSuperadmin();

    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        ...USER_SELECT,
        isDemo: true,
        createdBy: { select: { id: true, email: true, name: true } },
        _count: { select: { projects: true } },
      },
    });

    return NextResponse.json({ users });
  });
}

/**
 * Create an executive.
 *
 * The role is fixed here rather than taken from the body. If it were read
 * from input, an executive who found this endpoint could promote themselves
 * by adding one field to their JSON — so `createUserSchema` has no role field
 * and the call below passes EXECUTIVE explicitly.
 */
export async function POST(request: Request) {
  return route('POST /api/admin/users', async ({ requestId }) => {
    const actor = await requireSuperadmin();

    const limit = rateLimit(`admin-users:${actor.id}`, CREATES_PER_WINDOW, WINDOW_SECONDS);
    if (!limit.allowed) {
      throw new ApiError(429, 'Too many changes at once. Please try again shortly.');
    }

    const input = await parseBody(request, createUserSchema);

    const existing = await prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, 'An account with that email already exists.');
    }

    try {
      const user = await createUser({
        email: input.email,
        name: input.name,
        password: input.password,
        role: 'EXECUTIVE',
        createdById: actor.id,
      });

      logger.info('executive created', {
        requestId,
        userId: actor.id,
        createdUserId: user.id,
      });

      return NextResponse.json({ user }, { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'An account with that email already exists.');
      }
      throw error;
    }
  });
}
