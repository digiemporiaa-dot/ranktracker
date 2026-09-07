'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Pencil, Trash2 } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { SearchSettings, type SearchSettingsValue } from '@/components/search-settings';

export type EditableProject = {
  id: string;
  name: string;
  domain: string;
  country: string;
  city: string | null;
  language: string;
  devices: string[];
  googleDomain: string;
};

/** Edit dialog, opened from the project page header. */
export function EditProjectDialog({ project }: { project: EditableProject }) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const initial = () => ({
    name: project.name,
    domain: project.domain,
    search: {
      country: project.country,
      city: project.city ?? '',
      language: project.language,
      devices: [...project.devices],
      // Shown as an explicit choice: the project already resolved to one.
      googleDomain: project.googleDomain,
    } satisfies SearchSettingsValue,
  });

  const [form, setForm] = useState(initial);
  // Acknowledgement that changing the website invalidates existing history.
  const [confirmDomain, setConfirmDomain] = useState(false);

  const sameDevices =
    form.search.devices.length === project.devices.length &&
    form.search.devices.every((device) => project.devices.includes(device));

  // Compared loosely: the server normalizes "https://WWW.X.com/" to "x.com",
  // so only an obviously different value should trip the warning.
  const domainChanged =
    form.domain.trim().toLowerCase() !== project.domain.trim().toLowerCase();

  const changed =
    form.name.trim() !== project.name ||
    domainChanged ||
    form.search.country !== project.country ||
    form.search.city.trim() !== (project.city ?? '') ||
    form.search.language !== project.language ||
    form.search.googleDomain !== project.googleDomain ||
    !sameDevices;

  // A website change is only allowed once the warning has been acknowledged.
  const blocked = domainChanged && !confirmDomain;

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setForm(initial());
      setConfirmDomain(false);
      setError(null);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (form.search.devices.length === 0) {
      setError('Select at least one device to track.');
      return;
    }

    setPending(true);

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          domain: form.domain.trim(),
          country: form.search.country,
          city: form.search.city.trim() || null,
          language: form.search.language,
          devices: form.search.devices,
          ...(form.search.googleDomain ? { googleDomain: form.search.googleDomain } : {}),
          ...(domainChanged ? { confirmDomainChange: true } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The project could not be saved. Please try again.');
        return;
      }

      setOpen(false);
      setConfirmDomain(false);
      toast('Project saved');
      router.refresh();
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Change the name and the search settings.</DialogDescription>
        </DialogHeader>

        <form onSubmit={save} className="space-y-4">
          {error ? <Alert tone="error">{error}</Alert> : null}

          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Project name</Label>
            <Input
              id="edit-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-domain">Website</Label>
            <Input
              id="edit-domain"
              value={form.domain}
              onChange={(event) => setForm({ ...form, domain: event.target.value })}
              required
            />
            <p className="text-xs text-muted-foreground">
              We store the domain only, so www and subdomains all count as yours.
            </p>
          </div>

          {domainChanged ? (
            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-start gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                This changes what the ranking history means
              </p>
              <p className="text-xs text-muted-foreground">
                Every position already recorded for this project was measured for{' '}
                <span className="font-mono text-foreground">{project.domain}</span>. If you switch
                to <span className="font-mono text-foreground">{form.domain.trim()}</span>, the old
                rows stay in the chart, so one line will describe two different websites. Tracking a
                genuinely different site is usually better done as a new project.
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={confirmDomain}
                  onChange={(event) => setConfirmDomain(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-input accent-destructive"
                />
                I understand, change the website anyway
              </label>
            </div>
          ) : null}

          <SearchSettings
            idPrefix="edit"
            value={form.search}
            onChange={(search) => setForm({ ...form, search })}
            disabled={pending}
          />

          <p className="text-xs text-muted-foreground">
            The location, language and devices apply to keywords you add from now on. Keywords
            already in this project keep the settings they were added with and keep being
            checked that way, so their history stays comparable.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reset(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !changed || blocked}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Danger zone: clear every keyword, or delete the project.
 *
 * Kept at the bottom of the project page and visually separated, so neither
 * control sits anywhere near "Add keywords".
 */
export function ProjectDangerZone({
  project,
  keywordCount,
}: {
  project: EditableProject;
  keywordCount: number;
}) {
  return (
    <section className="rounded-xl border border-destructive/30 bg-card">
      <div className="border-b border-destructive/20 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          These actions delete ranking history permanently and cannot be undone.
        </p>
      </div>

      <div className="divide-y divide-border">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Clear all keywords</p>
            <p className="text-sm text-muted-foreground">
              Removes all {keywordCount} keyword{keywordCount === 1 ? '' : 's'} and their entire
              ranking history. The project itself stays.
            </p>
          </div>
          <ClearKeywordsDialog project={project} keywordCount={keywordCount} />
        </div>

        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Delete this project</p>
            <p className="text-sm text-muted-foreground">
              Deletes the project, its keywords and every ranking ever recorded for it.
            </p>
          </div>
          <DeleteProjectDialog project={project} keywordCount={keywordCount} />
        </div>
      </div>
    </section>
  );
}

/** Shared typed-confirmation dialog body. */
function useTypedConfirm(project: EditableProject) {
  const [typed, setTyped] = useState('');
  const matches = typed === project.name;
  return { typed, setTyped, matches };
}

function ClearKeywordsDialog({
  project,
  keywordCount,
}: {
  project: EditableProject;
  keywordCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { typed, setTyped, matches } = useTypedConfirm(project);

  async function clearAll() {
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/projects/${project.id}/keywords/all`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The keywords could not be cleared. Please try again.');
        return;
      }

      setOpen(false);
      setTyped('');
      toast(`Cleared ${data.deleted} keyword${data.deleted === 1 ? '' : 's'}`);
      router.refresh();
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTyped('');
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0" disabled={keywordCount === 0}>
          Clear keywords
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear all keywords?</DialogTitle>
          <DialogDescription>
            All {keywordCount} keyword{keywordCount === 1 ? '' : 's'} in{' '}
            <strong className="text-foreground">{project.name}</strong> will be deleted, along
            with every position ever recorded for them. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="space-y-1.5">
            <Label htmlFor="clear-confirm">
              Type <span className="font-mono text-foreground">{project.name}</span> to confirm
            </Label>
            <Input
              id="clear-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={clearAll} disabled={pending || !matches}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete all keywords
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectDialog({
  project,
  keywordCount,
}: {
  project: EditableProject;
  keywordCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { typed, setTyped, matches } = useTypedConfirm(project);

  async function remove() {
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The project could not be deleted. Please try again.');
        return;
      }

      toast(`Deleted "${project.name}"`);
      router.push('/projects');
      router.refresh();
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTyped('');
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" className="shrink-0">
          <Trash2 className="h-4 w-4" />
          Delete project
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this project?</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{project.name}</strong> ({project.domain}), its{' '}
            {keywordCount} keyword{keywordCount === 1 ? '' : 's'} and the full ranking history
            will be deleted permanently. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm">
              Type <span className="font-mono text-foreground">{project.name}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={pending || !matches}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
