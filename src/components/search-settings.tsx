'use client';

import { useEffect, useId, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  COUNTRIES,
  COUNTRY_CODES,
  DEVICES,
  LANGUAGES,
  LANGUAGE_CODES,
  type CountryCode,
} from '@/config/serp';

/**
 * Where and how a project is checked: country, optional city, language, and
 * the devices to track.
 *
 * Shared by the create form and the edit dialog so the two cannot drift.
 *
 * DataForSEO's location ids never appear here. The city is typed or picked by
 * name and the id is looked up on the server when the project is saved, so
 * nobody has to know one exists.
 */

export type SearchSettingsValue = {
  country: string;
  city: string;
  language: string;
  devices: string[];
};

export function googleDomainFor(country: string): string {
  return COUNTRIES[country as CountryCode]?.googleDomain ?? 'google.com';
}

export function SearchSettings({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: SearchSettingsValue;
  onChange: (next: SearchSettingsValue) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [cities, setCities] = useState<string[]>([]);
  const [cityNotice, setCityNotice] = useState<string | null>(null);

  // Suggestions follow the country, and narrow as the user types. A failure
  // here is never fatal: the city is optional and the country still works.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ country: value.country });
      if (value.city.trim()) params.set('search', value.city.trim());

      try {
        const response = await fetch(`/api/locations/cities?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          cities?: { label: string }[];
          unavailable?: string;
        };
        if (cancelled) return;

        setCities((data.cities ?? []).map((city) => city.label));
        setCityNotice(data.unavailable ?? null);
      } catch {
        // An aborted or failed lookup just leaves the suggestions as they were.
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [value.country, value.city]);

  function toggleDevice(device: string) {
    const next = value.devices.includes(device)
      ? value.devices.filter((entry) => entry !== device)
      : [...value.devices, device];
    onChange({ ...value, devices: next });
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-4" disabled={disabled}>
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Search location
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-country`}>
              Country <span className="text-destructive">*</span>
            </Label>
            <Select
              id={`${idPrefix}-country`}
              name="country"
              value={value.country}
              required
              onChange={(event) =>
                // A city belongs to a country, so changing the country clears it.
                onChange({ ...value, country: event.target.value, city: '' })
              }
            >
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {COUNTRIES[code].label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-city`}>City</Label>
            <Input
              id={`${idPrefix}-city`}
              name="city"
              list={listId}
              value={value.city}
              autoComplete="off"
              placeholder="Optional"
              onChange={(event) => onChange({ ...value, city: event.target.value })}
            />
            <datalist id={listId}>
              {cities.map((city) => (
                <option key={city} value={city} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              {cityNotice ??
                'City is optional. If no city is selected, rankings are checked at the country level.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-language`}>Language</Label>
            <Select
              id={`${idPrefix}-language`}
              name="language"
              value={value.language}
              onChange={(event) => onChange({ ...value, language: event.target.value })}
            >
              {LANGUAGE_CODES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGES[code].label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-google`}>Google</Label>
            <Input id={`${idPrefix}-google`} value={googleDomainFor(value.country)} readOnly disabled />
            <p className="text-xs text-muted-foreground">
              Chosen automatically from the country.
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Devices
        </legend>

        <div className="flex flex-wrap gap-4 pt-1">
          {DEVICES.map((device) => (
            <label
              key={device.code}
              htmlFor={`${idPrefix}-device-${device.code}`}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                id={`${idPrefix}-device-${device.code}`}
                type="checkbox"
                checked={value.devices.includes(device.code)}
                onChange={() => toggleDevice(device.code)}
                className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
              />
              {device.label}
            </label>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Pick one or both. Each device is checked with its own search and kept as its own
          history, so choosing both doubles the searches a check makes.
        </p>
      </fieldset>
    </div>
  );
}
