import pg from 'pg';
import type { Config } from './config.ts';

/** Builds the database pool for the API login (`sauna_api`). */
export function createDbPool(cfg: Config): pg.Pool {
  const url = new URL(cfg.API_DATABASE_URL);
  return new pg.Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: url.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: true } : undefined,
    max: cfg.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'saunaklar-api',
  });
}
