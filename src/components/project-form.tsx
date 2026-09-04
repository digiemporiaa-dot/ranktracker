'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchSettings, type SearchSettingsValue } from '@/components/search-settings';
import { DEFAULT_COUNTRY, DEFAULT_DEVICES, DEFAULT_LANGUAGE } from '@/config/serp';

export function ProjectForm({ onCancel }: { onCancel?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [search, setSearch] = useState<SearchSettingsValue>({
    country: DEFAULT_COUNTRY,
    city: '',
    language: DEFAULT_LANGUAGE,
    devices: [...DEFAULT_DEVICES],
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (search.devices.length === 0) {
      setError('Select at least one device to track.');
      return;
    }

    setPending(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name') ?? ''),
      domain: String(form.get('domain') ?? ''),
      country: search.country,
      // An empty box means the whole country, which the server reads as null.
      city: search.city.trim() || null,
      language: search.language,
      devices: search.devices,
    };

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The project could not be created. Please try again.');
        setPending(false);
        return;
      }

      router.push(`/projects/${data.project.id}`);
      router.refresh();
    } catch {
      setError('We could not reach the server. Please try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="space-y-1.5">
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" placeholder="Wroffy India" required maxLength={120} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="domain">Website</Label>
        <Input id="domain" name="domain" placeholder="https://wroffy.com" required />
        <p className="text-xs text-muted-foreground">
          We store the domain only, so www and subdomains all count as yours.
        </p>
      </div>

      <SearchSettings
        idPrefix="new"
        value={search}
        onChange={setSearch}
        disabled={pending}
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create project
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
