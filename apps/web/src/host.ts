/**
 * Which app does this host serve? The tenant comes only from the Host header
 * (design 5.1), so the SPA makes the same decision as the API, using the
 * shared parser from `@saunaklar/shared`:
 *
 *   {slug}.<platform-domain>  → reseller storefront
 *   <platform-domain>, www.   → platform landing page
 *
 * Anything else (an IP, a nested subdomain, an invalid or reserved slug) is
 * answered by the platform page, which explains that no storefront lives there.
 */
import { parseHost as parseSharedHost, normaliseHost, type HostConfig } from '@saunaklar/shared';

export type { HostConfig };

export type HostKind =
  | { kind: 'storefront'; slug: string }
  | { kind: 'platform'; reason: 'root' | 'unknown-host' | 'reserved-slug'; attempted?: string };

/**
 * Exactly the `reserved_slugs` seed (packages/db/migrations/0010_reference_data.sql) so the SPA does not even ask the API for
 * them; the database stays the authority.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'api', 'admin', 'app', 'assets', 'static', 'cdn', 'mail', 'smtp',
  'help', 'support', 'status', 'docs', 'blog', 'dev', 'staging', 'test',
]);

export function parseHost(host: string, config: HostConfig): HostKind {
  const parsed = parseSharedHost(host, config);
  switch (parsed.kind) {
    case 'platform':
      return { kind: 'platform', reason: 'root' };
    case 'storefront':
      return RESERVED_SLUGS.has(parsed.slug)
        ? { kind: 'platform', reason: 'reserved-slug', attempted: parsed.slug }
        : parsed;
    default: {
      const attempted = normaliseHost(host) ?? undefined;
      return attempted ? { kind: 'platform', reason: 'unknown-host', attempted } : { kind: 'platform', reason: 'unknown-host' };
    }
  }
}

/**
 * Runtime config written at deploy time to /config.js (apps/web/public/config.js
 * sets an empty object; .github/scripts/deploy-web.sh overwrites it), so one
 * build artifact serves every environment.
 */
declare global {
  interface Window {
    __SK_CONFIG__?: {
      platformDomain?: string;
      /** Single-shop edition: the one shop's slug (see `singleShop` in @saunaklar/shared). */
      singleShop?: string;
      /** Languages offered, first = default when the browser asks for none of them. */
      locales?: string[];
    };
  }
}

/** Precedence: runtime config, then build-time VITE_* (local builds), then localhost defaults. */
export function resolveHostConfig(
  runtime: { platformDomain?: string; singleShop?: string } | undefined,
  buildEnv: { VITE_PLATFORM_DOMAIN?: string; VITE_SINGLE_SHOP?: string },
): HostConfig {
  const singleShop = runtime?.singleShop || buildEnv.VITE_SINGLE_SHOP || undefined;
  return {
    platformDomain: runtime?.platformDomain || buildEnv.VITE_PLATFORM_DOMAIN || 'localhost',
    ...(singleShop ? { singleShop } : {}),
  };
}

export function hostConfig(): HostConfig {
  return resolveHostConfig(typeof window === 'undefined' ? undefined : window.__SK_CONFIG__, import.meta.env);
}

/** The current window's host, parsed once per page load. */
let cached: HostKind | undefined;

export function currentHost(): HostKind {
  return (cached ??= readHost());
}

function readHost(): HostKind {
  return parseHost(window.location.host, hostConfig());
}

/** Absolute URL of a storefront, e.g. for the platform page's examples. */
export function storefrontUrl(slug: string, config: HostConfig = hostConfig()): string {
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${config.platformDomain}${port ? `:${port}` : ''}/`;
}
