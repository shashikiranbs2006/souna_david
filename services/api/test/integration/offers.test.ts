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

  it('tracks what the customer does with the share link and scores it', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Track Me' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Tracked' });
    const offer = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    const none = await c.get(`/api/admin/offers/${offer.body.id}/tracking`);
    expect(none.body).toMatchObject({ link: null, opens: 0, score: { level: 'NONE' } });

    const link = await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 14 });
    const token = /\/s\/([A-Za-z0-9_-]{20,})$/.exec(link.body.url)![1]!;
    // The shop's own open does not count.
    expect((await c.get(`/api/shared/${token}`)).status).toBe(200);
    expect((await c.get(`/api/admin/offers/${offer.body.id}/tracking`)).body.opens).toBe(0);

    const visitor = h.client('alpha.localhost');
    const ua = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile', 'x-forwarded-for': '203.0.113.77' };
    expect((await visitor.get(`/api/shared/${token}`, ua)).status).toBe(200);
    const visit = '3f2b8c1e-5a47-4d0e-9b61-2c7d8e9f0a1b';
    expect((await visitor.post(`/api/shared/${token}/activity`, { visitId: visit, insideView: true, seconds: 45 })).status).toBe(200);
    expect((await visitor.post(`/api/shared/${token}/activity`, { visitId: visit, insideView: false, seconds: 150 })).status).toBe(200);
    expect((await visitor.post('/api/shared/not-a-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/activity', { visitId: visit, insideView: true, seconds: 5 })).status).toBeGreaterThanOrEqual(400);

    const t = await c.get(`/api/admin/offers/${offer.body.id}/tracking`);
    expect(t.body).toMatchObject({ opens: 1, visitors: 1, insideViewOpened: true, longestVisitSeconds: 150 });
    expect(t.body.recent[0]).toMatchObject({ device: 'MOBILE', network: '203.0.113.0/24' });
    expect(t.body.score.reasons.map((r: { code: string }) => r.code)).toEqual(['OPENED', 'INSIDE_VIEW', 'LONG_VISIT', 'OPENED_QUICKLY']);
    expect(t.body.score).toMatchObject({ points: 50, level: 'MEDIUM' });
  });

  it('serves a watermarked PDF and image, and only for the shop\'s own quotes', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Pdf Person' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Pdf cfg' });
    const offer = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id, quantity: 2, lines: [{ label: 'Delivery', amountMinor: 1000 }] });
    const res = await c.req('GET', `/api/admin/offers/${offer.body.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('Q-');
    const beta = await staff('beta.localhost', 'owner@beta.test');
    expect((await beta.req('GET', `/api/admin/offers/${offer.body.id}/pdf`)).status).toBe(404);

    const jpeg = (await import('sharp')).default({ create: { width: 320, height: 200, channels: 3, background: '#445566' } }).jpeg().toBuffer();
    const img = await c.post('/api/admin/watermark-image', { image: (await jpeg).toString('base64'), label: 'Pdf cfg' });
    expect(img.status, JSON.stringify(img.body).slice(0, 200)).toBe(200);
    expect(img.body.contentType).toBe('image/png');
    expect(Buffer.from(img.body.dataBase64, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect((await c.post('/api/admin/watermark-image', { image: 'x'.repeat(200) })).status).toBe(422);
  });
});
