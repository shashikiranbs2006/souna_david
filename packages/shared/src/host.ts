/**
 * Host → tenant parsing (design 5.1). The tenant comes ONLY from the Host
 * header, validated against the slug pattern, never from a parameter.
 */

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export type HostKind =
  | { kind: 'storefront'; slug: string }
  | { kind: 'platform' }
  | { kind: 'unknown' };

export interface HostConfig {
  /** e.g. `saunas.example.com`, or `localhost` in development. */
  platformDomain: string;
  /**
   * Single-shop edition: every host serves this one storefront, so the
   * shop can live on its own domain (no `{slug}.<platform-domain>` subdomain, no platform page).
   */
  singleShop?: string;
}

/** Lower-cases and strips the port. Returns null for anything that is not a plain hostname. */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/:\d{1,5}$/, '');
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  return host;
}

export function parseHost(raw: string | null | undefined, cfg: HostConfig): HostKind {
  const host = normaliseHost(raw);
  if (!host) return { kind: 'unknown' };
  const domain = normaliseHost(cfg.platformDomain);
  if (cfg.singleShop) return SLUG_PATTERN.test(cfg.singleShop) ? { kind: 'storefront', slug: cfg.singleShop } : { kind: 'unknown' };
  if (!domain) return { kind: 'unknown' };
  if (host === domain || host === `www.${domain}`) return { kind: 'platform' };
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return { kind: 'unknown' };
  const slug = host.slice(0, -suffix.length);
  // Exactly one label: `a.b.domain` is not a tenant.
  if (!SLUG_PATTERN.test(slug)) return { kind: 'unknown' };
  return { kind: 'storefront', slug };
}

export function storefrontHost(slug: string, cfg: HostConfig): string {
  // The single shop is served on the platform domain itself.
  if (cfg.singleShop === slug) return cfg.platformDomain;
  return `${slug}.${cfg.platformDomain}`;
}
