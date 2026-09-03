'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, Pencil, Trash2 } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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
import {
  COUNTRIES,
  COUNTRY_CODES,
  DEVICES,
  LANGUAGES,
  LANGUAGE_CODES,
} from '@/config/serp';

export type EditableProject = {
  id: string;
  name: string;
  domain: string;
  country: string;
  language: string;
  device: string;
};

/** Edit dialog, opened from the project page header. */
export function EditProjectDialog({ project }: { project: EditableProject }) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [form, setForm] = useState({
    name: project.name,
    country: project.country,
    language: project.language,
    device: project.device,
  });

  const changed =
    form.name.trim() !== project.name ||
    form.country !== project.country ||
    form.language !== project.language ||
    form.device !== project.device;

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setForm({
        name: project.name,
        country: project.country,
        language: project.language,
        device: project.device,
      });
      setError(null);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          country: form.country,
          language: form.language,
          device: form.device,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The project could not be saved. Please try again.');
        return;
      }

      setOpen(false);
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
            <Label htmlFor="edit-domain" className="flex items-center gap-1.5">
              Website
              <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
            </Label>
            <Input id="edit-domain" value={project.domain} readOnly disabled />
            <p className="text-xs text-muted-foreground">
              The website cannot be changed. Every recorded position belongs to this domain, so
              changing it would leave one history describing two different sites. To track a
              different website, create a new project.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-country">Country</Label>
              <Select
                id="edit-country"
                value={form.country}
                onChange={(event) => setForm({ ...form, country: event.target.value })}
              >
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {COUNTRIES[code].label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-language">Language</Label>
              <Select
                id="edit-language"
                value={form.language}
                onChange={(event) => setForm({ ...form, language: event.target.value })}
              >
                {LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGES[code].label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-device">Device</Label>
              <Select
                id="edit-device"
                value={form.device}
                onChange={(event) => setForm({ ...form, device: event.target.value })}
              >
                {DEVICES.map((device) => (
                  <option key={device.code} value={device.code}>
                    {device.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Country, language and device apply to keywords you add from now on. Keywords already
            in this project keep the settings they were added with, and will keep being checked
            that way.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reset(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !changed}>
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
