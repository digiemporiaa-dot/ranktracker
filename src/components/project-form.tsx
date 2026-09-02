'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  COUNTRIES,
  COUNTRY_CODES,
  DEFAULT_COUNTRY,
  DEFAULT_DEVICE,
  DEFAULT_LANGUAGE,
  DEVICES,
  LANGUAGES,
  LANGUAGE_CODES,
} from '@/config/serp';

export function ProjectForm({ onCancel }: { onCancel?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const payload = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

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

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <Select id="country" name="country" defaultValue={DEFAULT_COUNTRY}>
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {COUNTRIES[code].label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="language">Language</Label>
          <Select id="language" name="language" defaultValue={DEFAULT_LANGUAGE}>
            {LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGES[code].label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="device">Device</Label>
          <Select id="device" name="device" defaultValue={DEFAULT_DEVICE}>
            {DEVICES.map((device) => (
              <option key={device.code} value={device.code}>
                {device.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

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
