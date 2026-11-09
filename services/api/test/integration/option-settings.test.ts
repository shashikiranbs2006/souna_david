import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db/seed';
import { createHarness, type Client, type Harness } from './harness.ts';

/** Per-reseller option settings (migration 0015): admin endpoints, storefront offer, server-side checks. */
let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

const M = SEED.models;
const O = SEED.options;

async function staff(host: string, email: string): Promise<Client> {
  const c = h.client(host);
  await c.staffLogin(email, SEED_PASSWORD);
  return c;
}
type Opt = { id: string; enabled: boolean; basePriceMinor: number; priceOverrideMinor: number | null; effectivePriceMinor: number; descriptionOverride: string | null };
const optionOf = (body: { groups: { options: Opt[] }[] }, id: string) => body.groups.flatMap(g => g.options).find(o => o.id === id)!;
const offered = (sauna: { groups: { options: { id: string; priceDeltaMinor: number; description: string | null }[] }[] }, id: string) =>
  sauna.groups.flatMap(g => g.options).find(o => o.id === id);
const set = (optionId: string, enabled: boolean, priceOverrideMinor: number | null = null, descriptionOverride: string | null = null) =>
  ({ optionId, enabled, priceOverrideMinor, descriptionOverride });

describe('reseller admin: option settings', () => {
  it('lists every option of an assigned sauna with the reseller\'s settings', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const r = await alpha.get(`/api/admin/saunas/${M('aurora-hex')}/options`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.currency).toBe('EUR');
    expect(optionOf(r.body, O('salt-wall'))).toMatchObject({ enabled: false, priceOverrideMinor: null });
    expect(optionOf(r.body, O('aroma'))).toMatchObject({ enabled: true, basePriceMinor: 18000, priceOverrideMinor: 15000, effectivePriceMinor: 15000 });
    expect(r.body.groups.find((g: { code: string }) => g.code === 'door')).toMatchObject({ required: true });
  });

  it('validates a change: options of the sauna only, required groups and requires rules kept', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const path = `/api/admin/saunas/${M('espoo-compact')}/options`;
    const foreign = await alpha.put(path, { options: [set(O('salt-wall'), false)] });
    expect([foreign.status, foreign.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    const doors = await alpha.put(path, { options: ['door-clear', 'door-bronze', 'door-satin', 'door-wood'].map(d => set(O(d), false)) });
    expect([doors.status, doors.body.code]).toEqual([422, 'OPTION_RULES_VIOLATED']);
    const requires = await alpha.put(path, { options: [set(O('led-backrest'), false)] });
    expect([requires.status, requires.body.code]).toEqual([422, 'OPTION_RULES_VIOLATED']);
    const negative = await alpha.put(path, { options: [set(O('aroma'), true, -5)] });
    expect(negative.status).toBe(422);
  });
});

describe('storefront: effective options, prices and server-side checks', () => {
  it('shows each reseller its own offer of the same sauna', async () => {
    const alpha = (await h.client('alpha.localhost').get('/api/catalog/saunas/aurora-hex')).body;
    expect(offered(alpha, O('salt-wall'))).toBeUndefined();
    expect(offered(alpha, O('aroma'))!.priceDeltaMinor).toBe(15000);
    const beta = (await h.client('beta.localhost').get('/api/catalog/saunas/aurora-hex')).body;
    expect(offered(beta, O('salt-wall'))).toBeDefined();
    expect(offered(beta, O('aroma'))!.priceDeltaMinor).toBe(17000);
  });

  it('resets an option to the manufacturer\'s values', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const put = await alpha.put(`/api/admin/saunas/${M('espoo-compact')}/options`, { options: [set(O('door-wood'), true), set(O('led-backrest'), true)] });
    expect(put.status).toBe(200);
    expect(optionOf(put.body, O('door-wood')).enabled).toBe(true);
    expect(optionOf(put.body, O('led-backrest'))).toMatchObject({ priceOverrideMinor: null, descriptionOverride: null, effectivePriceMinor: 24000 });
    const n = await h.owner.query('select 1 from reseller_sauna_options where reseller_id = $1 and sauna_model_id = $2', [SEED.resellers.alpha, M('espoo-compact')]);
    expect(n.rowCount).toBe(0);
  });
});
