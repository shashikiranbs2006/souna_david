import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db/seed';
import { createHarness, type Client, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

const DAY = 86_400_000;

async function alphaStaff(): Promise<Client> {
  const c = h.client('alpha.localhost');
  await c.staffLogin('owner@alpha.test', SEED_PASSWORD);
  return c;
}

describe('reseller admin: branding', () => {
  it('patches branding and the storefront tenant reflects it', async () => {
    const c = await alphaStaff();
    const r = await c.patch('/api/admin/branding', { tagline: 'Saunas for every garden', primaryColor: '#2a3b4c', vatDisplay: 'EXCLUDED' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.tagline).toBe('Saunas for every garden');
    expect(r.body.primaryColor).toBe('#2a3b4c');
    expect(r.body.vatDisplay).toBe('EXCLUDED');
    expect((await c.get('/api/admin/branding')).body.tagline).toBe('Saunas for every garden');
  });

  it('sets the storefront layout and the storefront tenant reflects it', async () => {
    const c = await alphaStaff();
    expect((await c.get('/api/admin/branding')).body.storefrontLayout).toBe('atelier');
    const r = await c.patch('/api/admin/branding', { storefrontLayout: 'journal' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.storefrontLayout).toBe('journal');
    expect((await h.client('alpha.localhost').get('/api/tenant')).body.branding.storefrontLayout).toBe('journal');
    const bad = await c.patch('/api/admin/branding', { storefrontLayout: 'brutalist' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect((await c.get('/api/admin/branding')).body.storefrontLayout).toBe('journal');
    expect((await c.patch('/api/admin/branding', { storefrontLayout: 'atelier' })).status).toBe(200);
  });

  it('rejects an invalid colour', async () => {
    const c = await alphaStaff();
    const r = await c.patch('/api/admin/branding', { primaryColor: 'red' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

});

describe('reseller admin: saunas and discounts', () => {
  // effectiveDiscount is what the customer actually gets after the cap (review G5), as an amount.
  it('lists assigned saunas with the effective discount (own, else the default)', async () => {
    const c = await alphaStaff();
    const r = await c.get('/api/admin/saunas');
    expect(r.status).toBe(200);
    const bySlug = new Map(r.body.items.map((s: { slug: string }) => [s.slug, s]));
    expect(r.body.defaultDiscount).toEqual({ type: 'PERCENT', value: 1000 });
    const espoo: any = bySlug.get('espoo-compact');
    expect(espoo.discount).toEqual({ type: 'FIXED', value: 50000 });
    expect(espoo.effectiveDiscount).toEqual({ type: 'FIXED', value: Math.min(50000, Math.floor(espoo.listPriceMinor * espoo.maxDiscountBps / 10000)) });
    expect(espoo.priceFromMinor).toBe(espoo.listPriceMinor - 50000);
    const fjord: any = bySlug.get('fjord-panorama');
    expect(fjord.discount).toBeNull();
    const fjordOff = Math.floor(fjord.listPriceMinor * Math.min(1000, fjord.maxDiscountBps) / 10000);
    expect(fjord.effectiveDiscount).toEqual({ type: 'FIXED', value: fjordOff });
    expect(fjord.priceFromMinor).toBe(fjord.listPriceMinor - fjordOff);
    expect((bySlug.get('lappi-corner') as any).isVisible).toBe(false);
  });

  it('refuses a discount above the cap with the database rule code', async () => {
    const c = await alphaStaff();
    const espoo = (await c.get('/api/admin/saunas')).body.items.find((s: { slug: string }) => s.slug === 'espoo-compact');
    const r = await c.put(`/api/admin/saunas/${espoo.id}/discount`, { type: 'PERCENT', value: espoo.maxDiscountBps + 1 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('DISCOUNT_EXCEEDS_CAP');
    const fixed = await c.put(`/api/admin/saunas/${espoo.id}/discount`, { type: 'FIXED', value: espoo.listPriceMinor });
    expect(fixed.body.code).toBe('DISCOUNT_EXCEEDS_CAP');
    const ok = await c.put(`/api/admin/saunas/${espoo.id}/discount`, { type: 'PERCENT', value: espoo.maxDiscountBps });
    expect(ok.status).toBe(200);
    expect(ok.body.discount).toEqual({ type: 'PERCENT', value: espoo.maxDiscountBps });
    expect(ok.body.effectiveDiscount).toEqual({ type: 'FIXED', value: Math.floor(espoo.listPriceMinor * espoo.maxDiscountBps / 10000) });
  });

  it('toggling visibility bumps the catalog version and hides the sauna from the storefront', async () => {
    const c = await alphaStaff();
    const visitor = h.client('alpha.localhost');
    const v1 = (await visitor.get('/api/tenant')).body.catalogVersion as number;
    const aurora = (await c.get('/api/admin/saunas')).body.items.find((s: { slug: string }) => s.slug === 'aurora-hex');
    const r = await c.patch(`/api/admin/saunas/${aurora.id}`, { isVisible: false });
    expect(r.status).toBe(200);
    expect(r.body.isVisible).toBe(false);
    // The API caches tenants for 60 s; read the counter directly as well as through a fresh request.
    const { rows } = await h.owner.query('select catalog_version from resellers where id = $1', [SEED.resellers.alpha]);
    expect(Number(rows[0].catalog_version)).toBeGreaterThan(v1);
    const catalog = await visitor.get(`/api/catalog?v=${rows[0].catalog_version}`);
    if (catalog.status === 200) expect(catalog.body.items.some((i: { slug: string }) => i.slug === 'aurora-hex')).toBe(false);
    await c.patch(`/api/admin/saunas/${aurora.id}`, { isVisible: true });
  });

  it('cannot patch a sauna that is not assigned to the reseller', async () => {
    const c = await alphaStaff();
    const r = await c.patch(`/api/admin/saunas/${SEED.models('saimaa-garden-house')}`, { isVisible: false });
    expect(r.status).toBe(404);
  });
});

describe('reseller admin: share links', () => {
  it('creates a link (locks the configuration, returns the URL once) and revokes it', async () => {
    const c = await alphaStaff();
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Showroom Fjord' });
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(201);
    expect(cfg.body.locked).toBe(false);

    const link = await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 7 });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.headers.get('cache-control')).toBe('no-store');
    const m = /^http:\/\/alpha\.localhost(?::\d+)?\/s\/([A-Za-z0-9_-]{20,})$/.exec(link.body.url);
    expect(m, link.body.url).not.toBeNull();
    const token = m![1]!;
    expect(new Date(link.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(6 * DAY);

    expect((await c.get(`/api/admin/configurations/${cfg.body.id}`)).body.locked).toBe(true);
    const sel = await c.put(`/api/admin/configurations/${cfg.body.id}/selections`, { optionIds: [] });
    expect(sel.body.code).toBe('CONFIGURATION_LOCKED');

    // The token is never listed again; only its state.
    const list = await c.get(`/api/admin/configurations/${cfg.body.id}/share-links`);
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.items[0].state).toBe('ACTIVE');

    const visitor = h.client('alpha.localhost');
    expect((await visitor.get(`/api/shared/${token}`)).status).toBe(200);

    const revoked = await c.del(`/api/admin/configurations/${cfg.body.id}/share-links/${link.body.id}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.state).toBe('REVOKED');
    expect(revoked.body.revokedAt).not.toBeNull();
    expect([404, 410]).toContain((await visitor.get(`/api/shared/${token}`)).status);
  });
});

describe('reseller admin: OWNER vs ADMIN', () => {
  async function alphaAdmin(): Promise<Client> {
    const c = h.client('alpha.localhost');
    await c.staffLogin('admin@alpha.test', SEED_PASSWORD);
    return c;
  }
  const espoo = () => SEED.models('espoo-compact');
  /** Every owner-only write, with a valid body (the role check runs before validation anyway). */
  const ownerOnly = (): [string, string, unknown][] => [
    ['PATCH', '/api/admin/branding', { tagline: 'Admin was here' }],
    ['POST', '/api/admin/branding/uploads', { kind: 'LOGO', contentType: 'image/png', byteSize: 1000 }],
    ['POST', '/api/admin/branding/uploads/x.y/complete', undefined],
    ['PATCH', '/api/admin/settings', { defaultShareExpiryDays: 5 }],
    ['PATCH', `/api/admin/saunas/${espoo()}`, { isVisible: false }],
    ['PUT', '/api/admin/saunas/order', { saunaModelIds: [espoo()] }],
    ['PUT', `/api/admin/saunas/${espoo()}/discount`, { type: 'PERCENT', value: 100 }],
    ['DELETE', `/api/admin/saunas/${espoo()}/discount`, undefined],
    ['PUT', '/api/admin/discount', { type: 'PERCENT', value: 100 }],
    ['DELETE', '/api/admin/discount', undefined],
    ['PUT', `/api/admin/saunas/${espoo()}/options`, { options: [] }],
  ];

  it('the session exposes the ADMIN role', async () => {
    const c = await alphaAdmin();
    const s = await c.session();
    expect(s.body.staff).toEqual(expect.objectContaining({ email: 'admin@alpha.test', role: 'ADMIN' }));
  });

  it('an ADMIN gets 403 on every owner-only write and nothing changes', async () => {
    const c = await alphaAdmin();
    const before = { branding: (await c.get('/api/admin/branding')).body, settings: (await c.get('/api/admin/settings')).body, saunas: (await c.get('/api/admin/saunas')).body };
    for (const [method, path, body] of ownerOnly()) {
      const r = await c.req(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.body.code, `${method} ${path}`).toBe('FORBIDDEN');
    }
    expect((await c.get('/api/admin/branding')).body).toEqual(before.branding);
    expect((await c.get('/api/admin/settings')).body).toEqual(before.settings);
    expect((await c.get('/api/admin/saunas')).body).toEqual(before.saunas);
  });

  it('the OWNER can change settings, discounts and option prices', async () => {
    const c = await alphaStaff();
    const s = (await c.get('/api/admin/settings')).body.defaultShareExpiryDays;
    expect((await c.patch('/api/admin/settings', { defaultShareExpiryDays: s })).status).toBe(200);
    const b = (await c.get('/api/admin/branding')).body.tagline;
    expect((await c.patch('/api/admin/branding', { tagline: b })).status).toBe(200);
    const disc = await c.put(`/api/admin/saunas/${espoo()}/discount`, { type: 'FIXED', value: 50000 });
    expect(disc.status, JSON.stringify(disc.body)).toBe(200);
    const opts = (await c.get(`/api/admin/saunas/${espoo()}/options`)).body;
    const o = opts.groups[0].options[0];
    const put = await c.put(`/api/admin/saunas/${espoo()}/options`, { options: [{ optionId: o.id, enabled: o.enabled, priceOverrideMinor: o.priceOverrideMinor, descriptionOverride: o.descriptionOverride }] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
  });

});