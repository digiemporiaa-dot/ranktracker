import { Badge } from '@/components/ui/badge';
import { COUNTRIES, deviceLabel, type CountryCode } from '@/config/serp';

/**
 * Read-only summary of where and how a project is checked.
 *
 * Shown on the project list and the project header so the configuration behind
 * a number is visible without opening the edit dialog. The location id is not
 * among these: it is an implementation detail of the provider, and nothing a
 * user needs to see.
 */

export function countryLabel(country: string): string {
  return COUNTRIES[country as CountryCode]?.label ?? country;
}

/** "New Delhi, Delhi · India", or just "India" for a country-level project. */
export function locationLabel(country: string, city: string | null): string {
  const label = countryLabel(country);
  return city ? `${city} · ${label}` : label;
}

export function SearchSummaryBadges({
  country,
  city,
  devices,
  googleDomain,
}: {
  country: string;
  city: string | null;
  devices: string[];
  googleDomain?: string;
}) {
  return (
    <>
      <Badge variant="outline">{locationLabel(country, city)}</Badge>
      {devices.map((device) => (
        <Badge key={device} variant="outline">
          {deviceLabel(device)}
        </Badge>
      ))}
      {googleDomain ? <Badge variant="outline">{googleDomain}</Badge> : null}
    </>
  );
}
