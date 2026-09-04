import 'server-only';

import type { Device, Project } from '@prisma/client';

import { resolveLocation } from '@/lib/locations';
import type { CountryCode } from '@/config/serp';

/**
 * Turning "these keywords, here, on these devices" into rows.
 *
 * Both the paste box and the CSV import land here, so a keyword added either
 * way gets exactly the same location and device treatment.
 */

/** The search configuration a batch of new keywords will be created with. */
export type KeywordTarget = {
  country: string;
  city: string | null;
  locationCode: number;
  googleDomain: string;
  language: string;
  devices: Device[];
};

type ProjectDefaults = Pick<
  Project,
  'country' | 'city' | 'locationCode' | 'googleDomain' | 'language' | 'devices'
>;

type Overrides = {
  country?: CountryCode;
  city?: string | null;
  language?: string;
  devices?: Device[];
};

/**
 * Work out where and on what these keywords will be checked.
 *
 * The project's own settings are the default. An override only re-resolves the
 * location when the caller actually asked for a different place — otherwise
 * the project's already-resolved location id is reused, which keeps adding
 * keywords working even while the provider is unreachable.
 */
export async function resolveKeywordTarget(
  project: ProjectDefaults,
  overrides: Overrides,
  requestId: string,
): Promise<KeywordTarget> {
  const wantsDifferentLocation =
    overrides.country !== undefined || overrides.city !== undefined;

  const location = wantsDifferentLocation
    ? await resolveLocation(
        {
          country: overrides.country ?? (project.country as CountryCode),
          city:
            overrides.city !== undefined
              ? overrides.city
              : overrides.country !== undefined
                ? null
                : project.city,
        },
        requestId,
      )
    : {
        country: project.country,
        city: project.city,
        locationCode: project.locationCode,
        googleDomain: project.googleDomain,
      };

  return {
    country: location.country,
    city: location.city,
    locationCode: location.locationCode,
    googleDomain: location.googleDomain,
    language: overrides.language ?? project.language,
    devices: overrides.devices ?? project.devices,
  };
}

/**
 * One row per keyword per device.
 *
 * Tracking a keyword on desktop and mobile means two rows, because a keyword's
 * device is part of what makes it that keyword: two rows are what keeps a
 * mobile position from ever being written over a desktop one, and what makes
 * each device its own separate history.
 */
export function buildKeywordRows(
  projectId: string,
  entries: { keyword: string; targetUrl: string | null }[],
  target: KeywordTarget,
) {
  return entries.flatMap((entry) =>
    target.devices.map((device) => ({
      projectId,
      keyword: entry.keyword,
      targetUrl: entry.targetUrl,
      country: target.country,
      city: target.city,
      locationCode: target.locationCode,
      googleDomain: target.googleDomain,
      language: target.language,
      device,
    })),
  );
}
