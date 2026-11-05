import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_PASSWORD, SEED } from '@saunaklar/db/seed';
import { createHarness, type Harness } from './harness.ts';

// Contacts and quotes (0016): numbered per reseller, versioned, tenant-isolated.
let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

async function staff(host: string, email: string) {
  const c = h.client(host);
  await c.staffLogin(email, SEED_PASSWORD);
  return c;
}

describe('contacts and quotes', () => {
  it('creates a contact, a quote Q-1024 with extra lines, and a new version', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Maria Keller', organisation: 'Keller AG', email: 'maria@keller.test', mobile: '+41 79 000 00 00' });
    expect(contact.status, JSON.stringify(contact.body)).toBe(201);
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Keller Fjord' });
    const q = await c.post('/api/admin/offers', {
      contactId: contact.body.id, configurationId: cfg.body.id, quantity: 2, comment: 'Delivery in spring',
      lines: [{ label: 'Delivery', amountMinor: 45000 }, { label: 'Installation', amountMinor: 90000 }],
    });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    expect(q.body).toMatchObject({ number: 1024, label: 'Q-1024', version: 1, status: 'DRAFT', quantity: 2 });
    expect(q.body.totalMinor).toBe(q.body.unitPriceMinor * 2 + 135000);

    const v2 = await c.post(`/api/admin/offers/${q.body.id}/versions`, { quantity: 1 });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    expect(v2.body).toMatchObject({ number: 1024, version: 2, quantity: 1 });
    expect(v2.body.lines).toHaveLength(2);
    expect(v2.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const sent = await c.post(`/api/admin/offers/${v2.body.id}/status`, { status: 'SENT' });
    expect(sent.body.status).toBe('SENT');
    const list = await c.get(`/api/admin/offers?contactId=${contact.body.id}`);
    expect(list.body.items).toHaveLength(1); // latest version only
    expect(list.body.items[0].version).toBe(2);

    const next = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    expect(next.body.label).toBe('Q-1025');
  });

  it('keeps contacts and quotes inside one reseller', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await alpha.post('/api/admin/contacts', { personName: 'Only Alpha' });
    const beta = await staff('beta.localhost', 'owner@beta.test');
    expect((await beta.get(`/api/admin/contacts/${contact.body.id}`)).status).toBe(404);
    expect((await beta.get('/api/admin/contacts?q=Only')).body.items).toHaveLength(0);
    const cfg = await beta.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama') });
    expect((await beta.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id })).status).toBe(404);
  });

  it('updates a contact and rejects an empty name', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Tom' });
    const upd = await c.patch(`/api/admin/contacts/${contact.body.id}`, { organisation: 'Tom GmbH', mobile: '079 1' });
    expect(upd.body).toMatchObject({ personName: 'Tom', organisation: 'Tom GmbH', mobile: '079 1' });
    expect((await c.post('/api/admin/contacts', { personName: ' ' })).status).toBe(422);
  });
});
