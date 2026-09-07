import 'server-only';

import type { Role } from '@prisma/client';

import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

/**
 * Shared account creation.
 *
 * Used by the `create-superadmin` CLI and, from the admin surface, by
 * `POST /api/admin/users`. Keeping it in one place means password hashing and
 * normalization cannot drift between the two.
 *
 * `role` is a function argument, never a field read off a request body: an
 * HTTP caller must pass it explicitly, so an executive who finds the endpoint
 * cannot promote themselves by adding a role to their JSON.
 */
export type CreateUserInput = {
  email: string;
  name: string;
  password: string;
  role?: Role;
  createdById?: string | null;
};

/** The columns that are safe to return to a caller — never the password hash. */
export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(input: CreateUserInput) {
  return prisma.user.create({
    data: {
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role ?? 'EXECUTIVE',
      createdById: input.createdById ?? null,
    },
    select: USER_SELECT,
  });
}

/** Replace a user's password and sign them out everywhere. */
export async function setUserPassword(userId: string, password: string) {
  const passwordHash = await hashPassword(password);

  // The password change and the session purge go together: a reset that leaves
  // old sessions alive has not actually locked anyone out.
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

/** How many superadmins can still sign in. */
export async function activeSuperadminCount(): Promise<number> {
  return prisma.user.count({ where: { role: 'SUPERADMIN', isActive: true } });
}
