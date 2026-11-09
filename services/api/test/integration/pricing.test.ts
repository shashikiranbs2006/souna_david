import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db/seed';
import { createHarness, type Harness } from './harness.ts';

// The shop owner edits the base price and the largest discount of the saunas the shop offers.
let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

async function staff(host: string, email: string) {
  const c = h.client(host);
  await c.staffLogin(email, SEED_PASSWORD);
  return c;
}

describe('prices', () => {
  it('lists the shop\'s saunas with their price in the shop currency and changes one', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const before = await c.get('/api/admin/pricing');
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.currency).toBe('EUR');
    expect(before.body.items.length).toBeGreaterThan(0);
    const sauna = before.body.items[0];

    const put = await c.put(`/api/admin/pricing/${sauna.id}`, { listPriceMinor: 765_400, maxDiscountBps: 1250 });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const after = put.body.items.find((s: { id: string }) => s.id === sauna.id);
    expect(after).toMatchObject({ listPriceMinor: 765_400, maxDiscountBps: 1250 });

    // The storefront catalogue follows the new price.
    const catalog = await h.client('alpha.localhost').get('/api/catalog');
    const shown = catalog.body.items.find((s: { id: string }) => s.id === sauna.id);
    expect(shown.listPriceMinor).toBe(765_400);
  });

  it('rejects bad amounts and saunas the shop does not offer', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const { body } = await c.get('/api/admin/pricing');
    const id = body.items[0].id;
    expect((await c.put(`/api/admin/pricing/${id}`, { listPriceMinor: -5, maxDiscountBps: 100 })).status).toBe(422);
    expect((await c.put(`/api/admin/pricing/${id}`, { listPriceMinor: 1000, maxDiscountBps: 20_000 })).status).toBe(422);
    expect((await c.put('/api/admin/pricing/00000000-0000-4000-8000-000000000000', { listPriceMinor: 1000, maxDiscountBps: 100 })).status).toBe(404);
  });

  it('is for the owner only', async () => {
    const admin = await staff('alpha.localhost', 'admin@alpha.test');
    expect((await admin.get('/api/admin/pricing')).status).toBe(403);
    expect((await admin.put(`/api/admin/pricing/${SEED.models('fjord-panorama')}`, { listPriceMinor: 1, maxDiscountBps: 0 })).status).toBe(403);
    expect((await h.client('alpha.localhost').get('/api/admin/pricing')).status).toBe(401);
  });
});
