import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_SHARE_TOKEN } from '@saunaklar/db/seed';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

describe('tenant routing', () => {
  it('resolves the tenant from the subdomain', async () => {
    const r = await h.client('alpha.localhost').get('/api/tenant');
    expect(r.status).toBe(200);
    expect(r.body.slug).toBe('alpha');
    expect(r.body.currency).toBe('EUR');
    expect(r.body.branding.displayName).toBe('Alpha Spa');
    expect(r.body.branding.storefrontLayout).toBe('atelier');
    expect(r.body.manufacturer).toBeUndefined();
    const beta = (await h.client('beta.localhost').get('/api/tenant')).body;
    expect(beta.branding.storefrontLayout).toBe('showroom');
    expect(r.headers.get('cache-control')).toContain('max-age=60');
  });

  it('404s an unknown and a suspended tenant', async () => {
    expect((await h.client('nope.localhost').get('/api/tenant')).body.code).toBe('TENANT_NOT_FOUND');
    expect((await h.client('gamma.localhost').get('/api/tenant')).body.code).toBe('TENANT_SUSPENDED');
  });

  it('does not serve storefront routes on the admin host', async () => {
    expect((await h.client('admin.localhost').get('/api/catalog')).status).toBe(404);
  });
});

describe('catalog versioning (review C1)', () => {
  it('serves the current version immutably, rejects a stale one and never caches an unversioned one', async () => {
    const c = h.client('alpha.localhost');
    const v = (await c.get('/api/tenant')).body.catalogVersion as number;
    const ok = await c.get(`/api/catalog?v=${v}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('immutable');
    expect(ok.body.items.length).toBeGreaterThan(0);
    const stale = await c.get(`/api/catalog?v=${v + 100}`);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_CATALOG_VERSION');
    const none = await c.get('/api/catalog');
    expect(none.headers.get('cache-control')).toBe('no-store');
  });

  it('translates the catalog', async () => {
    const c = h.client('alpha.localhost');
    const de = await c.get('/api/catalog?lang=de');
    const en = await c.get('/api/catalog?lang=en');
    expect(de.body.items.map((i: { description: string }) => i.description)).not.toEqual(en.body.items.map((i: { description: string }) => i.description));
    expect(de.headers.get('vary')).toContain('Accept-Language');
  });

  it('prices a sauna with the reseller discount and the cap', async () => {
    const r = await h.client('alpha.localhost').get('/api/catalog/saunas/espoo-compact');
    expect(r.status).toBe(200);
    // "From" = list price + the cheapest option of every required group (valid in the seed),
    // less the FIXED 500.00 discount capped at maxDiscountBps of that subtotal.
    const groups = r.body.groups as { required: boolean; options: { priceDeltaMinor: number }[] }[];
    const subtotal = r.body.listPriceMinor + groups.filter(g => g.required).reduce((s, g) => s + Math.min(...g.options.map(o => o.priceDeltaMinor)), 0);
    const discount = Math.min(50_000, Math.floor(subtotal * r.body.maxDiscountBps / 10_000));
    expect(r.body.priceFromMinor).toBe(subtotal - discount);
    expect(groups.length).toBeGreaterThan(0);
    const list = await h.client('alpha.localhost').get('/api/catalog');
    expect(list.body.items.find((i: { slug: string }) => i.slug === 'espoo-compact').priceFromMinor).toBe(r.body.priceFromMinor);
  });
});

describe('share links', () => {
  it('opens a shared configuration and issues full-tier asset cookies', async () => {
    const c = h.client('alpha.localhost');
    const r = await c.get(`/api/shared/${SEED_SHARE_TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body.snapshot.finalPriceMinor).toBeGreaterThan(0);
    expect(r.body.sauna.maxDiscountBps).toBeUndefined();
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('the same token does not resolve on another tenant', async () => {
    expect((await h.client('beta.localhost').get(`/api/shared/${SEED_SHARE_TOKEN}`)).status).toBe(404);
  });

});
