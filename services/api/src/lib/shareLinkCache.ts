import { Redis } from 'ioredis';
import { sha256 } from './crypto.ts';
import type { Logger } from './log.ts';

/**
 * Cache in front of share-link resolution. A value is the link's identity and its two
 * state timestamps; `null` is a negative entry ("this token is unknown"). Callers must
 * still check expiresAt/revokedAt on every read: the cache never decides validity.
 */
export interface CachedShareLink {
  id: string;
  configurationId: string;
  expiresAt: string;
  revokedAt: string | null;
}
export type ShareLinkCacheValue = CachedShareLink | null;

export interface ShareLinkCache {
  /** `undefined` = not cached; `null` = cached as unknown token. */
  get(key: string): Promise<ShareLinkCacheValue | undefined>;
  set(key: string, value: ShareLinkCacheValue, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export const MAX_TTL_SECONDS = 300;
export const NEGATIVE_TTL_SECONDS = 30;

/** sha256(token) + tenant id. */
export const shareCacheKeyOfHash = (tokenHash: Buffer, tenantId: string): string => `sl:${tokenHash.toString('hex')}:${tenantId}`;
export const shareCacheKey = (token: string, tenantId: string): string => shareCacheKeyOfHash(sha256(token), tenantId);

/** Bounded in-process map with lazy expiry; the default, and what tests use. */
export class MemoryShareLinkCache implements ShareLinkCache {
  private readonly map = new Map<string, { value: ShareLinkCacheValue; until: number }>();
  constructor(private readonly clock: () => number = Date.now, private readonly maxEntries = 10_000) {}

  async get(key: string): Promise<ShareLinkCacheValue | undefined> {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.until <= this.clock()) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  async set(key: string, value: ShareLinkCacheValue, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { value, until: this.clock() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** Redis-backed cache. Every failure is logged and treated as a miss: Redis down never fails a request. */
export class RedisShareLinkCache implements ShareLinkCache {
  private readonly redis: Redis;
  constructor(url: string, private readonly log: Logger, client?: Redis) {
    this.redis = client ?? new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      commandTimeout: 500,
      retryStrategy: times => Math.min(times * 500, 10_000),
    });
    this.redis.on('error', err => this.log.warn('redis error', { err: String(err?.message ?? err) }));
  }

  private async guard<T>(op: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      return await fn();
    } catch (err) {
      this.log.warn('share link cache unavailable, using the database', { op, err: String((err as Error)?.message ?? err) });
      return fallback;
    }
  }

  get(key: string): Promise<ShareLinkCacheValue | undefined> {
    return this.guard('get', async () => {
      const raw = await this.redis.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as ShareLinkCacheValue);
    }, undefined);
  }

  set(key: string, value: ShareLinkCacheValue, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return Promise.resolve();
    return this.guard('set', async () => { await this.redis.set(key, JSON.stringify(value), 'EX', Math.ceil(ttlSeconds)); }, undefined);
  }

  delete(key: string): Promise<void> {
    return this.guard('delete', async () => { await this.redis.del(key); }, undefined);
  }
}

export function createShareLinkCache(redisUrl: string | undefined, log: Logger): ShareLinkCache {
  return redisUrl ? new RedisShareLinkCache(redisUrl, log) : new MemoryShareLinkCache();
}
