/**
 * Domain normalization and matching.
 *
 * Matching is done on parsed URL *hostnames* only. Substring checks such as
 * `url.includes(domain)` are unsafe: they match `fakewroffy.com`,
 * `wroffy.com.evil.com` and `example.com/wroffy.com`.
 */

/**
 * Reduce user input to a bare, lowercase, punycode host.
 *
 * Accepts anything a user is likely to paste:
 *   "https://www.Wroffy.com/pricing?a=1" -> "wroffy.com"
 *   "WWW.WROFFY.COM."                   -> "wroffy.com"
 *   "wroffy.com:8443"                   -> "wroffy.com"
 *
 * Returns null when the input cannot be read as a hostname.
 */
export function normalizeDomain(input: string): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;

  // Strip a scheme if present so the URL parser has something to work with,
  // then re-add a known one. This avoids "mailto:" style schemes sneaking in.
  value = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  // Drop credentials, path, query and fragment.
  value = value.split('/')[0].split('?')[0].split('#')[0];
  if (value.includes('@')) value = value.slice(value.lastIndexOf('@') + 1);

  let host: string;
  try {
    host = new URL(`https://${value}`).hostname;
  } catch {
    return null;
  }

  host = host.toLowerCase().replace(/\.+$/, '');

  // Reject IP literals and anything without a dot-separated TLD.
  if (host.startsWith('[')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (!host.includes('.')) return null;
  if (host.split('.').some((label) => label.length === 0)) return null;

  return stripWww(host);
}

/** Remove a single leading "www." label. */
export function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** Extract the lowercase hostname from a full URL, or null if unparseable. */
export function hostnameFromUrl(url: string): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Does `host` belong to `target`?
 *
 * True for the domain itself and any subdomain of it:
 *   wroffy.com, www.wroffy.com, blog.wroffy.com, shop.wroffy.com
 * False for lookalikes:
 *   fakewroffy.com, wroffy.com.fake.com, notwroffy.com
 *
 * Both arguments are expected to be hostnames, not URLs.
 */
export function hostMatchesDomain(host: string, target: string): boolean {
  const normalizedTarget = normalizeDomain(target);
  if (!normalizedTarget) return false;

  const normalizedHost = stripWww(
    String(host ?? '')
      .trim()
      .toLowerCase()
      .replace(/\.+$/, ''),
  );
  if (!normalizedHost) return false;

  if (normalizedHost === normalizedTarget) return true;
  // Subdomain: must end with "." + target, which rules out both
  // "fakewroffy.com" (no dot boundary) and "wroffy.com.fake.com"
  // (target is not the suffix).
  return normalizedHost.endsWith(`.${normalizedTarget}`);
}

/**
 * Does the URL point at the target domain?
 * Parses the URL first — never a substring test.
 */
export function urlMatchesDomain(url: string, target: string): boolean {
  const host = hostnameFromUrl(url);
  if (!host) return false;
  return hostMatchesDomain(host, target);
}

/**
 * Normalize a user-supplied target URL for storage/display.
 * Accepts a path ("/microsoft-reseller") or an absolute URL.
 */
export function normalizeTargetUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return value.replace(/\/{2,}/g, '/');
  return `/${value}`;
}
