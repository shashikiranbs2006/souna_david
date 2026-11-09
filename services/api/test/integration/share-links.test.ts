import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD, SEED_SHARE_TOKEN } from '@saunaklar/db/seed';
import { createHarness, type Harness } from './harness.ts';

// Short share links (token_hash is a sha256, so no migration is needed), the link cache and
// the failed-lookup limit.
let h: Harness;
let limited: Harness;
beforeAll(async () => {
  h = await createHarness();
  limited = await createHarness({ RATE_LIMIT: '1' });
}, 120_000);
afterAll(async () => { await h?.close(); await limited?.close(); });

async function owner(hx: Harness) {
  const c = hx.client('alpha.localhost');
  await c.staffLogin('owner@alpha.test', SEED_PASSWORD);
  return c;
}

async function newLink(c: ReturnType<Harness['client']>, name: string) {
  const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name });
  const link = await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 7 });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  const token = /\/s\/([^/]+)$/.exec(link.body.url)![1]!;
  return { cfgId: cfg.body.id as string, linkId: link.body.id as string, token };
}

describe('short share links', () => {
  it('creates a 10 character link that resolves, twice (second read is cached)', async () => {
    const c = await owner(h);
    const { token } = await newLink(c, 'Short');
    expect(token).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);
    const visitor = h.client('alpha.localhost');
    expect((await visitor.get(`/api/shared/${token}`)).status).toBe(200);
    expect((await visitor.get(`/api/shared/${token}`)).status).toBe(200);
  });

  it('resolves the seeded link, and no longer accepts 43 character tokens', async () => {
    const visitor = h.client('alpha.localhost');
    expect((await visitor.get(`/api/shared/${SEED_SHARE_TOKEN}`)).status).toBe(200);
    expect((await visitor.get(`/api/shared/${'L'.repeat(43)}`)).status).toBe(404);
  });

  it('answers 404 for unknown and malformed tokens, and never for another tenant', async () => {
    const c = await owner(h);
    const { token } = await newLink(c, 'Tenant');
    const visitor = h.client('alpha.localhost');
    expect((await visitor.get('/api/shared/abcdefghij')).status).toBe(404);
    expect((await visitor.get('/api/shared/short')).status).toBe(404);
    expect((await h.client('beta.localhost').get(`/api/shared/${token}`)).status).toBe(404);
  });

  it('refuses a revoked link at once, although it was cached', async () => {
    const c = await owner(h);
    const { cfgId, linkId, token } = await newLink(c, 'Revoke');
    const visitor = h.client('alpha.localhost');
    expect((await visitor.get(`/api/shared/${token}`)).status).toBe(200);
    expect((await visitor.get(`/api/shared/${token}`)).status).toBe(200);
    expect((await c.del(`/api/admin/configurations/${cfgId}/share-links/${linkId}`)).status).toBe(200);
    const after = await visitor.get(`/api/shared/${token}`);
    expect(after.status).toBe(410);
    expect(after.body.code).toBe('SHARE_LINK_REVOKED');
  });

  it('caches only until the link expires', async () => {
    const c = await owner(h);
    const { linkId } = await newLink(c, 'Expire');
    const token = 'ShortLive2';
    await h.owner.query(
      "insert into share_links (reseller_id, configuration_id, token_hash, created_by_staff_id, expires_at) select reseller_id, configuration_id, $1, created_by_staff_id, now() + interval '2 seconds' from share_links where id = $2",
      [createHash('sha256').update(token).digest(), linkId]);
    const visitor = h.client('alpha.localhost');
    expect((await visitor.get(`/api/shared/${token}`)).status).toBe(200);
    await new Promise(r => setTimeout(r, 2500));
    const r = await visitor.get(`/api/shared/${token}`);
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('SHARE_LINK_EXPIRED');
  });
});

describe('failed lookups are rate limited per client IP', () => {
  it('429s after repeated unknown tokens, and does not punish other IPs or valid links', async () => {
    const c = await owner(limited);
    const { token } = await newLink(c, 'Limited');
    const attacker = limited.client('alpha.localhost');
    const ip = { 'x-forwarded-for': '198.51.100.9' };
    const guess = (i: number) => attacker.get(`/api/shared/${String(i).padStart(10, 'a')}`, ip);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await guess(i)).status);
    expect(statuses.slice(0, 15).every(s => s === 404)).toBe(true);
    expect(statuses.slice(15).every(s => s === 429)).toBe(true);
    // Even the right token is refused for that IP while it is blocked ...
    expect((await attacker.get(`/api/shared/${token}`, ip)).status).toBe(429);
    // ... but not for everyone else.
    expect((await limited.client('alpha.localhost').get(`/api/shared/${token}`, { 'x-forwarded-for': '198.51.100.10' })).status).toBe(200);
  });
});
