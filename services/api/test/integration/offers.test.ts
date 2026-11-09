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

  it('counts a reload and a link-preview bot as nothing, a second visitor as a second open', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Count Me' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Counted' });
    const offer = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    const link = await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 14 });
    const token = /\/s\/([A-Za-z0-9_-]{20,})$/.exec(link.body.url)![1]!;
    const opens = async () => (await c.get(`/api/admin/offers/${offer.body.id}/tracking`)).body;

    const bot = { 'user-agent': 'WhatsApp/2.23.20.0 A', 'x-forwarded-for': '198.51.100.9' };
    await h.client('alpha.localhost').get(`/api/shared/${token}`, bot);
    expect((await opens()).opens).toBe(0);

    const one = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'x-forwarded-for': '203.0.113.5' };
    const v = h.client('alpha.localhost');
    await v.get(`/api/shared/${token}`, one);
    await v.get(`/api/shared/${token}`, one); // reload
    expect((await opens()).opens).toBe(1);

    await h.client('alpha.localhost').get(`/api/shared/${token}`, { ...one, 'x-forwarded-for': '203.0.114.5' });
    expect(await opens()).toMatchObject({ opens: 2, visitors: 2 });
    // The quotes list shows the same count and when the link was last opened.
    const listed = await c.get(`/api/admin/offers?contactId=${contact.body.id}`);
    expect(listed.body.items[0]).toMatchObject({ opens: 2 });
    expect(listed.body.items[0].lastOpenedAt).not.toBeNull();
  });

  it('only lets an open quote change status, and only on its newest version', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Status Rules' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Rules' });
    const v1 = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    const v2 = await c.post(`/api/admin/offers/${v1.body.id}/versions`, { quantity: 2 });
    expect((await c.post(`/api/admin/offers/${v1.body.id}/status`, { status: 'SENT' })).status).toBe(409); // old version
    expect((await c.post(`/api/admin/offers/${v2.body.id}/status`, { status: 'ACCEPTED' })).status).toBe(200);
    expect((await c.post(`/api/admin/offers/${v2.body.id}/status`, { status: 'DRAFT' })).status).toBe(409); // final
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

describe('reports and quote search', () => {
  it('filters quotes by number and open status and reports the totals', async () => {
    const c = await staff('beta.localhost', 'owner@beta.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Report Person' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama') });
    const a = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    const b = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    await c.post(`/api/admin/offers/${a.body.id}/status`, { status: 'ACCEPTED' });
    await c.post(`/api/admin/offers/${b.body.id}/status`, { status: 'SENT' });
    const byNumber = await c.get(`/api/admin/offers?number=${a.body.number}`);
    expect(byNumber.body.items.map((o: { id: string }) => o.id)).toEqual([a.body.id]);
    const open = await c.get('/api/admin/offers?open=1');
    expect(open.body.items.map((o: { id: string }) => o.id)).toContain(b.body.id);
    expect(open.body.items.map((o: { id: string }) => o.id)).not.toContain(a.body.id);

    await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 3 });
    const r = await c.get('/api/admin/reports');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.conversion.accepted).toBeGreaterThanOrEqual(1);
    expect(r.body.conversion.percent).toBeGreaterThan(0);
    expect(r.body.topModels.length).toBeGreaterThan(0);
    expect(r.body.linkActivity.linksShared).toBeGreaterThanOrEqual(1);
    expect(r.body.expiring.some((e: { label: string }) => e.label === b.body.label)).toBe(true);
  });
});

describe('prepayment invoices', () => {
  it('invoices an accepted quote, numbers it, marks it paid and builds the PDF', async () => {
    const c = await staff('alpha.localhost', 'owner@alpha.test');
    const contact = await c.post('/api/admin/contacts', { personName: 'Invoice Person' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama') });
    const q = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id, lines: [{ label: 'Delivery', amountMinor: 10000 }] });
    const early = await c.post('/api/admin/invoices', { quoteId: q.body.id });
    expect(early.status).toBe(409); // not accepted yet
    await c.post(`/api/admin/offers/${q.body.id}/status`, { status: 'ACCEPTED' });
    const inv = await c.post('/api/admin/invoices', { quoteId: q.body.id, percent: 40, dueInDays: 10, paymentDetails: 'IBAN CH00 0000' });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body).toMatchObject({ percent: 40, status: 'ISSUED', overdue: false, quoteTotalMinor: q.body.totalMinor });
    expect(inv.body.amountMinor).toBe(Math.round(q.body.totalMinor * 0.4));
    expect(inv.body.label).toMatch(/^INV-\d+$/);
    const next = await c.post('/api/admin/invoices', { quoteId: q.body.id });
    expect(next.body.number).toBe(inv.body.number + 1);
    const paid = await c.post(`/api/admin/invoices/${inv.body.id}/status`, { status: 'PAID' });
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.paidAt).not.toBeNull();
    expect((await c.get(`/api/admin/invoices?quoteId=${q.body.id}`)).body.items).toHaveLength(2);
    const pdf = await c.get(`/api/admin/invoices/${inv.body.id}/pdf`);
    expect(pdf.status).toBe(200);
    const beta = await staff('beta.localhost', 'owner@beta.test');
    expect((await beta.get(`/api/admin/invoices/${inv.body.id}`)).status).toBe(404);
  });
});
