import type { Context } from 'hono';
import type { Pool, PoolClient } from 'pg';
import type { HostKind } from '@saunaklar/shared';
import type { Adapters } from './adapters/index.ts';
import type { Config } from './config.ts';
import type { Logger } from './lib/log.ts';
import type { ShareLinkCache } from './lib/shareLinkCache.ts';

export interface Deps {
  config: Config;
  pool: Pool;
  adapters: Adapters;
  log: Logger;
  now: () => Date;
  /** Share-link cache; absent = an in-process one is created on first use (see shareCacheOf). */
  shareCache?: ShareLinkCache;
}

export interface TenantInfo {
  id: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  currency: string;
  catalogVersion: number;
}

export type Principal =
  | { kind: 'anonymous' }
  | {
      kind: 'staff';
      staffId: string;
      email: string;
      displayName: string;
      role: 'OWNER' | 'ADMIN';
    };

export interface AppEnv {
  Variables: {
    deps: Deps;
    requestId: string;
    host: HostKind & { name: string };
    tenant: TenantInfo | null;
    principal: Principal;
    /** Per-browser random id (host-only cookie) that the CSRF token is bound to. */
    browserId: string;
    /** The access token was present but expired: protected routes answer SESSION_EXPIRED so the client refreshes. */
    sessionExpired: boolean;
  };
}

export type Ctx = Context<AppEnv>;
export type Db = PoolClient;
