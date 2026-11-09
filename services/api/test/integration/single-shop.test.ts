import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db/seed';
import { createHarness, type Harness } from './harness.ts';

// Single-shop edition: SINGLE_SHOP=holzsauna serves David's shop on any host but the admin
// host, and switches customer accounts off.
let h: Harness;
beforeAll(async () => { h = await createHarness({ SINGLE_SHOP: 'holzsauna', PLATFORM_DOMAIN: 'offers.holzsauna.test' }); }, 120_000);
afterAll(async () => { await h?.close(); });

const shop = () => h.client('offers.holzsauna.test');

describe('single-shop edition', () => {
  it('serves the one shop on its own domain, in CHF, with six saunas', async () => {
    const t = await shop().get('/api/tenant');
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ slug: 'holzsauna', currency: 'CHF' });
    const c = await shop().get('/api/catalog');
    expect(c.status).toBe(200);
    expect(c.body.items).toHaveLength(6);
  });

  it('serves the same shop on any other host, and keeps the admin host for the manufacturer', async () => {
    expect((await h.client('alpha.localhost').get('/api/tenant')).body.slug).toBe('holzsauna');
    expect((await h.client('admin.localhost').get('/api/catalog')).status).toBe(404);
  });

  it('refuses customer sign-up, sign-in and customer routes', async () => {
    const signup = await shop().post('/api/auth/signup', { email: 'x@example.test', password: SEED_PASSWORD, firstName: 'X', lastName: 'Y', locale: 'de', acceptTerms: true });
    expect(signup.status).toBe(404);
    expect((await shop().post('/api/auth/login', { email: 'anna@example.test', password: SEED_PASSWORD })).status).toBe(404);
    expect((await shop().get('/api/me')).status).toBe(404);
    expect((await shop().get('/api/configurations')).status).toBe(404);
  });

  it('keeps the session check and staff sign-in for the shop owner', async () => {
    expect((await shop().get('/api/auth/session')).status).toBe(200);
    const r = await shop().post('/api/auth/staff/login', { email: 'info@holzsauna.ch', password: SEED_PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('shows a share link to anyone, but nobody can claim it into an account', async () => {
    const c = shop();
    await c.staffLogin('info@holzsauna.ch', SEED_PASSWORD);
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'For Keller' });
    const link = await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 7 });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const token = /\/s\/([A-Za-z0-9_-]{20,})$/.exec(link.body.url)![1]!;
    const visitor = shop();
    const view = await visitor.get(`/api/shared/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.configuration.name).toBe('For Keller');
    expect((await visitor.post(`/api/shared/${token}/claim`, {})).status).toBe(404);
  });
});
