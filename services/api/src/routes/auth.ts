import type { Hono } from 'hono';
import { routes, type Session } from '@saunaklar/shared';
import { IdpError } from '../adapters/errors.ts';
import type { AppEnv, Ctx, Principal } from '../context.ts';
import { readCookie } from '../lib/cookies.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { clearSessionCookies, csrfTokenFor, loadPrincipal, setSessionCookies } from '../middleware/session.ts';

export function sessionBody(c: Ctx, principal: Principal = c.get('principal')): Session {
  const csrfToken = csrfTokenFor(c);
  if (principal.kind === 'staff') {
    return { kind: 'staff', csrfToken, staff: { id: principal.staffId, email: principal.email, displayName: principal.displayName, role: principal.role } };
  }
  return { kind: 'anonymous', csrfToken };
}

/** Who is signed in, and ending or renewing that session. Staff sign in through staffAuth.ts. */
export function registerAuth(app: Hono<AppEnv>): void {
  mount(app, routes.session, async ({ c }) => sessionBody(c));

  mount(app, routes.logout, async ({ c }) => {
    const { config, adapters } = c.get('deps');
    const rt = readCookie(c, config, 'rt');
    if (rt && readCookie(c, config, 'pool') === 'STAFF') await adapters.identity.revoke('STAFF', rt).catch(() => undefined);
    clearSessionCookies(c);
    return { ok: true as const };
  });

  mount(app, routes.refresh, async ({ c }) => {
    const { config, adapters } = c.get('deps');
    const rt = readCookie(c, config, 'rt');
    if (!rt || readCookie(c, config, 'pool') !== 'STAFF') throw new ApiError('UNAUTHENTICATED');
    try {
      const tokens = await adapters.identity.refresh('STAFF', rt);
      const { sub } = await adapters.identity.verifyAccessToken('STAFF', tokens.accessToken);
      const principal = await loadPrincipal(c, 'STAFF', sub);
      if (!principal) throw new ApiError('UNAUTHENTICATED');
      setSessionCookies(c, 'STAFF', tokens);
      c.set('principal', principal);
      return sessionBody(c, principal);
    } catch (err) {
      clearSessionCookies(c);
      if (err instanceof IdpError) throw new ApiError('SESSION_EXPIRED');
      throw err;
    }
  });
}
