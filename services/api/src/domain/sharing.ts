import { randomBytes } from 'node:crypto';
import type { Ctx, Db, Deps } from '../context.ts';
import { sha256 } from '../lib/crypto.ts';
import { ApiError } from '../lib/problem.ts';
import {
  MAX_TTL_SECONDS, MemoryShareLinkCache, NEGATIVE_TTL_SECONDS, shareCacheKey,
  type ShareLinkCache,
} from '../lib/shareLinkCache.ts';

/**
 * Share links (design 9.3): only the SHA-256 of the token is stored, so a database leak
 * exposes no working link. New links are 10 characters of an unambiguous base-58 alphabet
 * (~58 bits). The earlier 43-character base64url format is no longer accepted.
 * Short tokens are only safe together with the failed-lookup limit below.
 */
export const SHARE_TOKEN_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const SHARE_TOKEN_LENGTH = 10;

export function newShareToken(): string {
  let out = '';
  while (out.length < SHARE_TOKEN_LENGTH) {
    // Rejection sampling: 232 = 4 * 58, so bytes below it map to the alphabet without bias.
    for (const byte of randomBytes(SHARE_TOKEN_LENGTH * 2)) {
      if (byte < 232 && out.length < SHARE_TOKEN_LENGTH) out += SHARE_TOKEN_ALPHABET[byte % 58];
    }
  }
  return out;
}
export const hashShareToken = (token: string) => sha256(token);

const SHORT_TOKEN = /^[1-9A-HJ-NP-Za-km-z]{10}$/;
export const isShareTokenFormat = (token: string): boolean => SHORT_TOKEN.test(token);

export interface ShareLinkRow {
  id: string;
  configuration_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface ShareLookup {
  cache?: ShareLinkCache;
  tenantId?: string;
}

/**
 * Resolves a token within the current tenant, or throws GONE/NOT_FOUND. With a cache, the
 * database is skipped on a hit; expiry and revocation are re-checked on every read, so a
 * cached entry can never keep a dead link alive.
 */
export async function resolveShareToken(db: Db, token: string, now: Date, lookup: ShareLookup = {}): Promise<ShareLinkRow> {
  if (!isShareTokenFormat(token)) throw new ApiError('NOT_FOUND', 'This link does not exist.');
  const { cache, tenantId } = lookup;
  const key = cache && tenantId ? shareCacheKey(token, tenantId) : null;
  let link: ShareLinkRow | undefined;
  if (cache && key) {
    const hit = await cache.get(key);
    if (hit === null) throw new ApiError('NOT_FOUND', 'This link does not exist.');
    if (hit) link = { id: hit.id, configuration_id: hit.configurationId, expires_at: new Date(hit.expiresAt), revoked_at: hit.revokedAt ? new Date(hit.revokedAt) : null };
  }
  if (!link) {
    const { rows } = await db.query<ShareLinkRow>(
      'select id, configuration_id, expires_at, revoked_at from share_links where token_hash = $1', [hashShareToken(token)]);
    link = rows[0];
    if (!link) {
      if (cache && key) await cache.set(key, null, NEGATIVE_TTL_SECONDS);
      throw new ApiError('NOT_FOUND', 'This link does not exist.');
    }
    if (cache && key) {
      const ttl = Math.min(Math.floor((link.expires_at.getTime() - now.getTime()) / 1000), MAX_TTL_SECONDS);
      await cache.set(key, { id: link.id, configurationId: link.configuration_id, expiresAt: link.expires_at.toISOString(), revokedAt: link.revoked_at?.toISOString() ?? null }, ttl);
    }
  }
  if (link.revoked_at) throw new ApiError('SHARE_LINK_REVOKED', 'This link has been withdrawn.');
  if (link.expires_at <= now) throw new ApiError('SHARE_LINK_EXPIRED', 'This link has expired.');
  return link;
}

// ---- Per-process state, keyed by Deps so each app instance (and each test) is isolated ----

const fallbackCaches = new WeakMap<Deps, ShareLinkCache>();
export function shareCacheOf(deps: Deps): ShareLinkCache {
  if (deps.shareCache) return deps.shareCache;
  let cache = fallbackCaches.get(deps);
  if (!cache) fallbackCaches.set(deps, cache = new MemoryShareLinkCache());
  return cache;
}

/** Failed lookups allowed per client IP before the shared endpoints answer RATE_LIMITED. */
export const FAILED_LOOKUP_MAX = 15;
export const FAILED_LOOKUP_WINDOW_MS = 5 * 60_000;
const failures = new WeakMap<Deps, Map<string, { start: number; count: number }>>();

export function clientIp(c: Ctx): string {
  return c.req.header('cloudfront-viewer-address')?.split(':')[0] ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** Resolves a token for a request: cache, failed-lookup limit per IP, then the database. */
export async function resolveShareLink(c: Ctx, db: Db, token: string): Promise<ShareLinkRow> {
  const deps = c.get('deps');
  const now = deps.now();
  const tenant = c.get('tenant');
  const limited = deps.config.RATE_LIMIT;
  const ip = clientIp(c);
  let table = failures.get(deps);
  if (!table) failures.set(deps, table = new Map());
  const entry = table.get(ip);
  const live = entry && now.getTime() - entry.start < FAILED_LOOKUP_WINDOW_MS ? entry : undefined;
  if (limited && live && live.count >= FAILED_LOOKUP_MAX) {
    c.header('retry-after', String(Math.ceil((live.start + FAILED_LOOKUP_WINDOW_MS - now.getTime()) / 1000)));
    throw new ApiError('RATE_LIMITED', 'Too many requests. Try again shortly.');
  }
  try {
    return await resolveShareToken(db, token, now, { cache: shareCacheOf(deps), tenantId: tenant?.id });
  } catch (err) {
    if (limited && err instanceof ApiError && err.code === 'NOT_FOUND') {
      if (live) live.count++;
      else table.set(ip, { start: now.getTime(), count: 1 });
      if (table.size > 50_000) table.clear();
    }
    throw err;
  }
}

export function deviceClass(userAgent: string | undefined): 'MOBILE' | 'TABLET' | 'DESKTOP' | 'OTHER' {
  if (!userAgent) return 'OTHER';
  if (/iPad|Tablet|Nexus 7|Nexus 10|SM-T/i.test(userAgent)) return 'TABLET';
  if (/Mobi|iPhone|Android/i.test(userAgent)) return 'MOBILE';
  if (/Windows|Macintosh|Linux|CrOS/i.test(userAgent)) return 'DESKTOP';
  return 'OTHER';
}

export function shareState(link: { expires_at: Date; revoked_at: Date | null }, now: Date): 'ACTIVE' | 'EXPIRED' | 'REVOKED' {
  if (link.revoked_at) return 'REVOKED';
  return link.expires_at <= now ? 'EXPIRED' : 'ACTIVE';
}

/** A visitor's network, shortened so it cannot identify a household: IPv4 /24, IPv6 /48. */
export function visitorPrefix(header: { cloudfront?: string | undefined; forwardedFor?: string | undefined }): string | null {
  let ip = header.cloudfront ? header.cloudfront.replace(/:\d+$/, '') : header.forwardedFor?.split(',')[0]?.trim();
  if (!ip) return null;
  ip = ip.replace(/^\[|\]$/g, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(':')) {
    const groups = ip.split(':').filter(g => g !== '').slice(0, 3);
    return groups.length ? `${groups.join(':')}::/48` : null;
  }
  return null;
}
