'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Select } from '@/components/ui/select';

/** Switches the rankings page between the user's projects. */
export function ProjectSwitcher({
  projects,
  selectedId,
}: {
  projects: { id: string; name: string }[];
  selectedId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label="Project"
      value={selectedId}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        startTransition(() => router.push(`/rankings?project=${encodeURIComponent(next)}`));
      }}
      className="w-full sm:w-56"
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </Select>
  );
}
