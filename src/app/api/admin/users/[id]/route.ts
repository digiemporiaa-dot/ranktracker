import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { ApiError, parseBody, requireSuperadmin, route } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { deleteUserQuerySchema, updateUserSchema } from '@/lib/validation';
import { activeSuperadminCount, USER_SELECT } from '@/lib/users';
import { hashPassword } from '@/lib/auth';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

const CHANGES_PER_WINDOW = 30;
const WINDOW_SECONDS = 60 * 10;

/** Load the target, or 404 — the same shape the rest of the app uses. */
async function requireTarget(id: string) {
  const target = await prisma.user.findUnique({
    where: { id },
    select: { ...USER_SELECT, isDemo: true },
  });
  if (!target) throw new ApiError(404, 'That account could not be found.');
  return target;
}

/**
 * Refuse a change that would leave nobody able to administer the instance.
 *
 * Called before deactivating or deleting a superadmin.
 */
async function assertNotLastSuperadmin(target: { role: string; isActive: boolean }) {
  if (target.role !== 'SUPERADMIN' || !target.isActive) return;

  if ((await activeSuperadminCount()) <= 1) {
    throw new ApiError(
      400,
      'This is the only active administrator. Promote someone else before removing this account.',
    );
  }
}

/**
 * Rename, activate/deactivate, or reset a password.
 *
 * Note what is absent: there is no role field, so no request can promote or
 * demote anyone. Changing a role is a deliberate act performed with the
 * create-superadmin CLI, not something an HTTP body can do.
 */
export async function PATCH(request: Request, { params }: Params) {
  return route('PATCH /api/admin/users/[id]', async ({ requestId }) => {
    const actor = await requireSuperadmin();
    const { id } = await params;

    const limit = rateLimit(`admin-users:${actor.id}`, CHANGES_PER_WINDOW, WINDOW_SECONDS);
    if (!limit.allowed) {
      throw new ApiError(429, 'Too many changes at once. Please try again shortly.');
    }

    const target = await requireTarget(id);
    const input = await parseBody(request, updateUserSchema);

    if (input.isActive === false) {
      // Locking yourself out of your own instance is never what you meant.
      if (target.id === actor.id) {
        throw new ApiError(400, 'You cannot deactivate your own account.');
      }
      await assertNotLastSuperadmin(target);
    }

    const passwordHash = input.password ? await hashPassword(input.password) : null;

    // A deactivation or a password reset only takes effect once the existing
    // sessions are gone, so the two always happen together.
    const mustSignOut = input.isActive === false || passwordHash !== null;

    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id: target.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
        select: USER_SELECT,
      }),
      ...(mustSignOut
        ? [prisma.session.deleteMany({ where: { userId: target.id } })]
        : []),
    ]);

    logger.info('user updated', {
      requestId,
      userId: actor.id,
      targetUserId: target.id,
      // Field names only — never the new password.
      fields: Object.keys(input),
      signedOut: mustSignOut,
    });

    return NextResponse.json({ user });
  });
}

/**
 * Delete a user.
 *
 * The caller must say what happens to their projects. A bare DELETE is
 * refused: quietly destroying a client's entire ranking history because
 * somebody left the company is not an acceptable default.
 *
 *   ?onDelete=reassign&toUserId=<id>   move the projects to another account
 *   ?onDelete=purge                    delete the projects and all their data
 */
export async function DELETE(request: Request, { params }: Params) {
  return route('DELETE /api/admin/users/[id]', async ({ requestId }) => {
    const actor = await requireSuperadmin();
    const { id } = await params;

    const limit = rateLimit(`admin-users:${actor.id}`, CHANGES_PER_WINDOW, WINDOW_SECONDS);
    if (!limit.allowed) {
      throw new ApiError(429, 'Too many changes at once. Please try again shortly.');
    }

    const target = await requireTarget(id);

    if (target.id === actor.id) {
      throw new ApiError(400, 'You cannot delete your own account.');
    }

    const url = new URL(request.url);
    const parsed = deleteUserQuerySchema.safeParse({
      onDelete: url.searchParams.get('onDelete') ?? undefined,
      toUserId: url.searchParams.get('toUserId') ?? undefined,
    });

    if (!parsed.success) {
      throw new ApiError(
        400,
        'Say what should happen to this user\'s projects: reassign them to someone else, or purge them along with the account.',
      );
    }

    await assertNotLastSuperadmin(target);

    const projectCount = await prisma.project.count({ where: { userId: target.id } });

    if (parsed.data.onDelete === 'reassign') {
      const recipient = await prisma.user.findUnique({
        where: { id: parsed.data.toUserId },
        select: { id: true, email: true, isActive: true },
      });

      if (!recipient) throw new ApiError(400, 'That recipient account could not be found.');
      if (recipient.id === target.id) {
        throw new ApiError(400, 'Choose a different account to receive the projects.');
      }
      if (!recipient.isActive) {
        throw new ApiError(400, 'Choose an active account to receive the projects.');
      }

      // Project (userId, name) is unique per owner, so a name the recipient
      // already uses would fail the move. Report which ones rather than
      // renaming a client's project behind the admin's back.
      const [movingNames, existingNames] = await Promise.all([
        prisma.project.findMany({ where: { userId: target.id }, select: { name: true } }),
        prisma.project.findMany({ where: { userId: recipient.id }, select: { name: true } }),
      ]);
      const taken = new Set(existingNames.map((p) => p.name));
      const clashes = movingNames.map((p) => p.name).filter((name) => taken.has(name));

      if (clashes.length > 0) {
        throw new ApiError(
          409,
          `${recipient.email} already has a project named ${clashes
            .map((name) => `"${name}"`)
            .join(', ')}. Rename it first, then try again.`,
        );
      }

      // The move and the delete are one transaction: a half-done reassignment
      // would leave projects orphaned or the account still present.
      await prisma.$transaction([
        prisma.project.updateMany({
          where: { userId: target.id },
          data: { userId: recipient.id },
        }),
        prisma.user.delete({ where: { id: target.id } }),
      ]);

      logger.info('user deleted, projects reassigned', {
        requestId,
        userId: actor.id,
        targetUserId: target.id,
        recipientId: recipient.id,
        projects: projectCount,
      });

      return NextResponse.json({
        deleted: true,
        onDelete: 'reassign',
        projectsMoved: projectCount,
      });
    }

    // purge: projects, keywords, rankings and checks all cascade from the user.
    await prisma.user.delete({ where: { id: target.id } });

    logger.info('user deleted, projects purged', {
      requestId,
      userId: actor.id,
      targetUserId: target.id,
      projects: projectCount,
    });

    return NextResponse.json({ deleted: true, onDelete: 'purge', projectsPurged: projectCount });
  });
}
