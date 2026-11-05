import type { Db } from '../context.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { ApiError } from '../lib/problem.ts';

/**
 * Share links (design 9.3): 256-bit random tokens; only the SHA-256 is
 * stored, so a database leak exposes no working link.
 */
export const newShareToken = () => randomToken(32);
export const hashShareToken = (token: string) => sha256(token);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface ShareLinkRow {
  id: string;
  configuration_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

/** Resolves a token within the current tenant, or throws GONE/NOT_FOUND. */
export async function resolveShareToken(db: Db, token: string, now: Date): Promise<ShareLinkRow> {
  if (!TOKEN.test(token)) throw new ApiError('NOT_FOUND', 'This link does not exist.');
  const { rows } = await db.query<ShareLinkRow>(
    'select id, configuration_id, expires_at, revoked_at, created_at from share_links where token_hash = $1', [hashShareToken(token)]);
  const link = rows[0];
  if (!link) throw new ApiError('NOT_FOUND', 'This link does not exist.');
  if (link.revoked_at) throw new ApiError('SHARE_LINK_REVOKED', 'This link has been withdrawn.');
  if (link.expires_at <= now) throw new ApiError('SHARE_LINK_EXPIRED', 'This link has expired.');
  return link;
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
