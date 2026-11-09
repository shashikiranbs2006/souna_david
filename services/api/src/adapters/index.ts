/**
 * Adapter wiring. `createAdapters(env, {pool, log})` returns `{ identity, mailer, assetSigner, objectStore }`;
 * `createLocalEdge(env)` gives the local server its asset/upload verification hooks. Everything runs
 * in-process on the one server: the Postgres `idp` schema, the filesystem and HMAC signing; mail goes
 * through Resend or the dev mailbox. Adapters are created lazily.
 *
 * Environment (also in services/api/.env.example):
 *   STAFF_MFA                     REQUIRED | OPTIONAL TOTP policy for staff (default REQUIRED)
 *   TOTP_ISSUER                   issuer shown in authenticator apps (default Saunaklar)
 *   MAIL_FROM_DOMAIN              dev mailbox domain (default mail.localhost)
 *   MAIL_DEFAULT_FROM_NAME        From display name when no brand is given (default Saunaklar)
 *   RESEND_API_KEY                send mail through Resend instead of the dev mailbox
 *   MAIL_FROM_ADDRESS             sender address on a domain verified at Resend (default onboarding@resend.dev)
 *   LOCAL_IDP_JWT_SECRET          HS256 key of the local IdP (>= 32 bytes; dev default)
 *   LOCAL_ASSET_SIGNING_SECRET    HMAC key of local asset cookies/URLs (>= 32 bytes; dev default)
 *   LOCAL_UPLOAD_SIGNING_SECRET   HMAC key of /dev/uploads tokens (>= 32 bytes; dev default)
 *   LOCAL_OBJECTS_DIR             object store root (default <repo>/var/objects)
 *   LOCAL_ASSET_URL_SCHEME        scheme of signed AR URLs locally (default http)
 *   COOKIE_SECURE                 Secure attribute on local asset cookies (default true)
 */
import { bucketFromEnv, objectsDirFromEnv } from '@saunaklar/objects';
import type { Pool as PgPool } from 'pg';
import { LocalAssetSigner, verifyLocalAssetRequest, type LocalAssetRequest } from './assets/local.ts';
import { LocalIdentityProvider } from './idp/local.ts';
import { DevMailboxMailer } from './mail/dev-mailbox.ts';
import { ResendMailer } from './mail/resend.ts';
import { LocalObjectStore, type LocalUploadGrant } from './storage/local.ts';
import type { AssetSigner, IdentityProvider, Mailer, ObjectStore, Queryable, TxRunner } from './types.ts';

export * from './types.ts';
export { AdapterError, IdpError, isAdapterError } from './errors.ts';

type Env = Record<string, string | undefined>;

/** Exactly the adapters the routes use. */
export interface Adapters {
  readonly identity: IdentityProvider;
  readonly mailer: Mailer;
  readonly assetSigner: AssetSigner;
  /**
   * The asset bucket. Browsers PUT to staging keys `uploads/<slug>/<random>` (never served by
   * the edge); processed branding goes to `branding/<slug>/<random>/<name>`.
   */
  readonly objectStore: ObjectStore;
}

/** Hooks the local server uses to verify signed asset requests and presigned PUTs. */
export interface LocalEdge {
  verifyAssetRequest(req: LocalAssetRequest): boolean;
  /** Resolves a `/dev/uploads/<token>` token to its grant and the store to write into, or null. */
  verifyUpload(token: string): { grant: LocalUploadGrant; store: LocalObjectStore } | null;
}

interface MinimalLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface AdapterDeps {
  /** Pool of the API login (`sauna_api`); local adapters run as role `idp_local` on it. */
  pool?: Pick<PgPool, 'connect'>;
  log?: MinimalLogger;
}

const DEV_SECRETS = {
  LOCAL_IDP_JWT_SECRET: 'dev-only-local-idp-jwt-secret-0123456789abcdef',
  LOCAL_ASSET_SIGNING_SECRET: 'dev-only-local-asset-signing-secret-0123456789',
  LOCAL_UPLOAD_SIGNING_SECRET: 'dev-only-local-upload-signing-secret-012345678',
} as const;

/** Transaction runner with `SET LOCAL ROLE`, for the local IdP and dev mailbox. */
export function roleTx(pool: Pick<PgPool, 'connect'>, role: string): TxRunner {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('Invalid role name');
  return async <T>(fn: (db: Queryable) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await fn(client as unknown as Queryable);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };
}

/** Memoised lazy getter. */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  let made = false;
  return () => {
    if (!made) {
      value = make();
      made = true;
    }
    return value as T;
  };
}

export function createAdapters(env: Env = process.env, deps: AdapterDeps = {}): Adapters {
  return createLocalAdapters(env, deps);
}

function localSecret(env: Env, name: keyof typeof DEV_SECRETS): string {
  const value = env[name];
  if (value) return value;
  if (env.NODE_ENV === 'production') throw new Error(`Missing environment variable ${name}`);
  return DEV_SECRETS[name];
}

function localObjectStore(env: Env): LocalObjectStore {
  return new LocalObjectStore(bucketFromEnv(env), {
    rootDir: objectsDirFromEnv(env),
    secret: localSecret(env, 'LOCAL_UPLOAD_SIGNING_SECRET'),
  });
}

/** Verification hooks for the local edge emulator, configured from the same variables. */
export function createLocalEdge(env: Env = process.env): LocalEdge {
  const assetSecret = localSecret(env, 'LOCAL_ASSET_SIGNING_SECRET');
  const store = localObjectStore(env);
  return {
    verifyAssetRequest: (req) => verifyLocalAssetRequest(assetSecret, req),
    verifyUpload(token) {
      const grant = store.verifyUpload(token);
      return grant ? { grant, store } : null;
    },
  };
}

function createLocalAdapters(env: Env, deps: AdapterDeps): Adapters {
  const tx = lazy(() => {
    if (!deps.pool) throw new Error('Local adapters need a database pool');
    return roleTx(deps.pool, 'idp_local');
  });
  // With RESEND_API_KEY mail goes out through Resend; without it every mail lands in the dev mailbox.
  const mailer = lazy((): Mailer => env.RESEND_API_KEY
    ? new ResendMailer({ apiKey: env.RESEND_API_KEY, fromAddress: env.MAIL_FROM_ADDRESS || 'onboarding@resend.dev', defaultFromName: env.MAIL_DEFAULT_FROM_NAME || 'Saunaklar' })
    : new DevMailboxMailer(tx(), env.MAIL_FROM_DOMAIN || 'mail.localhost'));
  const identity = lazy(
    () =>
      new LocalIdentityProvider({
        tx: tx(),
        mailer: mailer(),
        jwtSecret: localSecret(env, 'LOCAL_IDP_JWT_SECRET'),
        staffMfa: env.STAFF_MFA === 'OPTIONAL' ? 'OPTIONAL' : 'REQUIRED',
        totpIssuer: env.TOTP_ISSUER || 'Saunaklar',
      }),
  );
  const assetSigner = lazy(
    () =>
      new LocalAssetSigner({
        secret: localSecret(env, 'LOCAL_ASSET_SIGNING_SECRET'),
        urlScheme: env.LOCAL_ASSET_URL_SCHEME === 'https' ? 'https' : 'http',
        secureCookies: env.COOKIE_SECURE !== '0' && env.COOKIE_SECURE !== 'false',
      }),
  );
  const objectStore = lazy(() => localObjectStore(env));
  return {
    get identity() {
      return identity();
    },
    get mailer() {
      return mailer();
    },
    get assetSigner() {
      return assetSigner();
    },
    get objectStore() {
      return objectStore();
    },
  };
}

export { verifyLocalAssetRequest } from './assets/local.ts';
export { verifyLocalUpload } from './storage/local.ts';
