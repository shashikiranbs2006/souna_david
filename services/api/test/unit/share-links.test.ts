import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/context.ts';
import { hashShareToken, isShareTokenFormat, newShareToken, resolveShareToken, SHARE_TOKEN_ALPHABET, type ShareLinkRow } from '../../src/domain/sharing.ts';
import { MemoryShareLinkCache, shareCacheKey } from '../../src/lib/shareLinkCache.ts';

describe('share tokens', () => {
  it('are 10 characters from the unambiguous base-58 alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const t = newShareToken();
      expect(t).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
      expect(isShareTokenFormat(t)).toBe(true);
    }
    expect(SHARE_TOKEN_ALPHABET).toHaveLength(58);
    for (const bad of ['0', 'O', 'I', 'l']) expect(SHARE_TOKEN_ALPHABET).not.toContain(bad);
  });

  it('do not repeat and use the whole alphabet', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const t = newShareToken();
      seen.add(t);
      for (const ch of t) chars.add(ch);
    }
    expect(seen.size).toBe(5000);
    expect(chars.size).toBe(58);
  });

  it('accept only the 10 character format', () => {
    expect(isShareTokenFormat('abcdEFGH23')).toBe(true);
    for (const bad of ['', 'short', 'a'.repeat(9), 'a'.repeat(11), 'a'.repeat(43), '0OIl123456', 'abc/def123', 'ab cd12345']) {
      expect(isShareTokenFormat(bad)).toBe(false);
    }
  });

  it('hash to 32 bytes (the token_hash column)', () => {
    expect(hashShareToken(newShareToken())).toHaveLength(32);
  });
});

describe('share link cache', () => {
  const NOW = new Date('2026-01-01T00:00:00Z');
  const TENANT = 'tenant-1';
  const token = 'abcdEFGH23';

  function fakeDb(row: ShareLinkRow | undefined) {
    const calls: unknown[][] = [];
    const db = { query: async (_sql: string, params: unknown[]) => { calls.push(params); return { rows: row ? [row] : [] }; } } as unknown as Db;
    return { db, calls };
  }
  const link = (over: Partial<ShareLinkRow> = {}): ShareLinkRow => ({
    id: 'l1', configuration_id: 'c1', expires_at: new Date(NOW.getTime() + 3600_000), revoked_at: null, ...over,
  });

  it('serves repeat lookups from the cache', async () => {
    const cache = new MemoryShareLinkCache(() => NOW.getTime());
    const { db, calls } = fakeDb(link());
    expect((await resolveShareToken(db, token, NOW, { cache, tenantId: TENANT })).id).toBe('l1');
    expect((await resolveShareToken(db, token, NOW, { cache, tenantId: TENANT })).configuration_id).toBe('c1');
    expect(calls).toHaveLength(1);
  });

  it('keys by token hash and tenant', async () => {
    expect(shareCacheKey(token, 'a')).not.toBe(shareCacheKey(token, 'b'));
    expect(shareCacheKey(token, 'a')).not.toContain(token);
  });

  it('refuses a cached link once it has expired, even if the cache still holds it', async () => {
    const stale = {
      get: async () => ({ id: 'l1', configurationId: 'c1', expiresAt: new Date(NOW.getTime() + 10_000).toISOString(), revokedAt: null }),
      set: async () => {}, delete: async () => {},
    };
    const { db, calls } = fakeDb(undefined);
    await expect(resolveShareToken(db, token, new Date(NOW.getTime() + 11_000), { cache: stale, tenantId: TENANT })).rejects.toMatchObject({ code: 'SHARE_LINK_EXPIRED' });
    expect(calls).toHaveLength(0);
  });

  it('expires entries after min(time to expiry, 300s)', async () => {
    let clock = NOW.getTime();
    const cache = new MemoryShareLinkCache(() => clock);
    const key = shareCacheKey(token, TENANT);
    const { db } = fakeDb(link());
    await resolveShareToken(db, token, NOW, { cache, tenantId: TENANT });
    clock += 299_000;
    expect(await cache.get(key)).toBeTruthy();
    clock += 2_000;
    expect(await cache.get(key)).toBeUndefined();

    // A link ending in 20s is cached for 20s only.
    clock = NOW.getTime();
    const short = fakeDb(link({ expires_at: new Date(NOW.getTime() + 20_000) }));
    await resolveShareToken(short.db, token, NOW, { cache, tenantId: TENANT });
    clock += 21_000;
    expect(await cache.get(key)).toBeUndefined();
  });

  it('refuses a cached revoked link and does not cache an already expired one', async () => {
    const cache = new MemoryShareLinkCache(() => NOW.getTime());
    const revoked = fakeDb(link({ revoked_at: NOW }));
    await expect(resolveShareToken(revoked.db, token, NOW, { cache, tenantId: TENANT })).rejects.toMatchObject({ code: 'SHARE_LINK_REVOKED' });
    await expect(resolveShareToken(revoked.db, token, NOW, { cache, tenantId: TENANT })).rejects.toMatchObject({ code: 'SHARE_LINK_REVOKED' });
    expect(revoked.calls).toHaveLength(1);

    const key = shareCacheKey('zzzzzzzzz2', TENANT);
    const expired = fakeDb(link({ expires_at: new Date(NOW.getTime() - 1000) }));
    await expect(resolveShareToken(expired.db, 'zzzzzzzzz2', NOW, { cache, tenantId: TENANT })).rejects.toMatchObject({ code: 'SHARE_LINK_EXPIRED' });
    expect(await cache.get(key)).toBeUndefined();
  });

  it('delete() drops the entry so a revoke is seen at once', async () => {
    const cache = new MemoryShareLinkCache(() => NOW.getTime());
    const first = fakeDb(link());
    await resolveShareToken(first.db, token, NOW, { cache, tenantId: TENANT });
    await cache.delete(shareCacheKey(token, TENANT));
    const second = fakeDb(link({ revoked_at: NOW }));
    await expect(resolveShareToken(second.db, token, NOW, { cache, tenantId: TENANT })).rejects.toMatchObject({ code: 'SHARE_LINK_REVOKED' });
    expect(second.calls).toHaveLength(1);
  });

  it('negative-caches unknown tokens for 30 seconds only', async () => {
    let clock = NOW.getTime();
    const cache = new MemoryShareLinkCache(() => clock);
    const { db, calls } = fakeDb(undefined);
    for (let i = 0; i < 3; i++) await expect(resolveShareToken(db, token, NOW, { cache, tenantId: TENANT })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
    expect(await cache.get(shareCacheKey(token, TENANT))).toBeNull();
    clock += 31_000;
    await expect(resolveShareToken(db, token, NOW, { cache, tenantId: TENANT })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(2);
  });

  it('malformed tokens never reach the cache or database', async () => {
    const cache = new MemoryShareLinkCache(() => NOW.getTime());
    const { db, calls } = fakeDb(link());
    await expect(resolveShareToken(db, 'nope', NOW, { cache, tenantId: TENANT })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });
});

describe('RedisShareLinkCache', () => {
  const warnings: string[] = [];
  const log = { debug() {}, info() {}, error() {}, warn: (m: string) => { warnings.push(m); }, child() { return log; } } as never;

  it('stores JSON with an expiry, and treats every Redis error as a miss', async () => {
    const store = new Map<string, { v: string; ex: number }>();
    let down = false;
    const fake = {
      status: 'ready', on() {},
      get: async (k: string) => { if (down) throw new Error('ECONNREFUSED'); return store.get(k)?.v ?? null; },
      set: async (k: string, v: string, _ex: string, ex: number) => { if (down) throw new Error('ECONNREFUSED'); store.set(k, { v, ex }); },
      del: async (k: string) => { if (down) throw new Error('ECONNREFUSED'); store.delete(k); },
    };
    const { RedisShareLinkCache } = await import('../../src/lib/shareLinkCache.ts');
    const cache = new RedisShareLinkCache('redis://x', log, fake as never);
    const value = { id: 'l1', configurationId: 'c1', expiresAt: '2026-01-01T00:00:00.000Z', revokedAt: null };
    await cache.set('k', value, 120.4);
    expect(store.get('k')!.ex).toBe(121);
    expect(await cache.get('k')).toEqual(value);
    await cache.set('neg', null, 30);
    expect(await cache.get('neg')).toBeNull();
    await cache.delete('k');
    expect(await cache.get('k')).toBeUndefined();

    down = true;
    expect(await cache.get('neg')).toBeUndefined();
    await expect(cache.set('k', value, 10)).resolves.toBeUndefined();
    await expect(cache.delete('k')).resolves.toBeUndefined();
    expect(warnings.length).toBe(3);
  });
});
