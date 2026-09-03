import { notFound } from 'next/navigation';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/api';
import { isSuperadmin } from '@/lib/auth';
import { USER_SELECT } from '@/lib/users';
import { PageHeader } from '@/components/page-header';
import { AdminUsers, type AdminUserRow } from '@/components/admin-users';

export const metadata = { title: 'Users · OurRankTracker' };
export const dynamic = 'force-dynamic';

/**
 * Account management, superadmin only.
 *
 * An executive gets a 404 rather than a "forbidden" page: the admin surface
 * should not be discoverable.
 */
export default async function AdminUsersPage() {
  const user = await requireUser();
  if (!isSuperadmin(user)) notFound();

  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      ...USER_SELECT,
      isDemo: true,
      createdBy: { select: { email: true } },
      _count: { select: { projects: true } },
    },
  });

  const rows: AdminUserRow[] = users.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    isDemo: row.isDemo,
    projectCount: row._count.projects,
    createdAt: row.createdAt.toISOString(),
    createdByEmail: row.createdBy?.email ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with access to this instance. Accounts are created here — there is no public sign-up."
      />
      <AdminUsers rows={rows} currentUserId={user.id} />
    </>
  );
}
