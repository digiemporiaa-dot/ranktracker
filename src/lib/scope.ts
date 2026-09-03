import 'server-only';

import type { SessionUser } from '@/lib/auth';

/**
 * Who a query is allowed to see.
 *
 * Spread into every project-scoped query rather than writing
 * `if (role === 'SUPERADMIN')` inside each handler: with the check in one
 * place there is no handler left to forget, and forgetting one would leak one
 * client's ranking data to another.
 *
 * The 404-not-403 convention survives automatically. An executive asking for
 * someone else's project matches zero rows, exactly as before, so a project
 * that exists but belongs to someone else is indistinguishable from one that
 * does not exist.
 */
export type ScopedUser = Pick<SessionUser, 'id' | 'role'>;

/** Filter for a query on `Project`. */
export function projectScope(user: ScopedUser): { userId?: string } {
  return user.role === 'SUPERADMIN' ? {} : { userId: user.id };
}

/**
 * Filter for a query on a model that reaches a project through a relation,
 * such as `RankCheck.projectId`.
 */
export function viaProjectScope(user: ScopedUser): { project?: { userId: string } } {
  return user.role === 'SUPERADMIN' ? {} : { project: { userId: user.id } };
}
