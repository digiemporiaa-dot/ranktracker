'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Users } from 'lucide-react';

import { Select } from '@/components/ui/select';

/**
 * Narrows the project list to one executive.
 *
 * Rendered for superadmins only. The server ignores the parameter for anyone
 * else, so this is a convenience rather than a permission boundary.
 */
export function OwnerFilter({
  owners,
  selectedId,
}: {
  owners: { id: string; email: string; _count: { projects: number } }[];
  selectedId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (owners.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <Select
        aria-label="Filter by executive"
        value={selectedId}
        disabled={pending}
        className="w-full sm:w-72"
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() =>
            router.push(next ? `/projects?owner=${encodeURIComponent(next)}` : '/projects'),
          );
        }}
      >
        <option value="">All executives ({owners.length})</option>
        {owners.map((owner) => (
          <option key={owner.id} value={owner.id}>
            {owner.email} — {owner._count.projects} project
            {owner._count.projects === 1 ? '' : 's'}
          </option>
        ))}
      </Select>
    </div>
  );
}
