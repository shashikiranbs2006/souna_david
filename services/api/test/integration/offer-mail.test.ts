import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db/seed';
import { createHarness, type Harness } from './harness.ts';

// The customer receives the quote by e-mail from the admin; a question from the customer link
// reaches the shop. Locally every mail lands in devtools.mailbox.
let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

async function owner() {
  const c = h.client('alpha.localhost');
  await c.staffLogin('owner@alpha.test', SEED_PASSWORD);
  return c;
}

const mailTo = async (to: string) =>
  (await h.owner.query<{ subject: string; html: string; text: string }>('select subject, html, text from devtools.mailbox where to_address = $1 order by id desc', [to])).rows;

describe('sending a quote by e-mail', () => {
  it('mails the offer with the PDF and a view-only link, and marks the quote as sent', async () => {
    const c = await owner();
    const contact = await c.post('/api/admin/contacts', { personName: 'Maria Keller', email: 'maria.keller@example.test' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Keller Fjord' });
    const offer = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id, comment: 'Delivery in spring' });
    expect(offer.body.status).toBe('DRAFT');

    const sent = await c.post(`/api/admin/offers/${offer.body.id}/send`, { message: 'Thank you for visiting us!', locale: 'de' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe('SENT');

    const [mail] = await mailTo('maria.keller@example.test');
    expect(mail!.subject).toContain(offer.body.label);
    expect(mail!.html).toContain('Thank you for visiting us!');
    expect(mail!.text).toMatch(/\/s\/[A-Za-z0-9_-]{8,}/);
    expect(mail!.text).toContain('Attachments: Q-');
  });

  it('refuses a contact without an e-mail address and changes nothing', async () => {
    const c = await owner();
    const contact = await c.post('/api/admin/contacts', { personName: 'No Mail' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'No mail sauna' });
    const offer = await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    const sent = await c.post(`/api/admin/offers/${offer.body.id}/send`, {});
    expect(sent.status).toBe(422);
    expect((await c.get(`/api/admin/offers/${offer.body.id}`)).body.status).toBe('DRAFT');
  });
});

describe('a question from the customer link', () => {
  it('reaches the shop by e-mail with the customer as Reply-To, and is rate limited', async () => {
    const c = await owner();
    const contact = await c.post('/api/admin/contacts', { personName: 'Asker' });
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name: 'Question sauna' });
    await c.post('/api/admin/offers', { contactId: contact.body.id, configurationId: cfg.body.id });
    const link = await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 7 });
    const token = /\/s\/([A-Za-z0-9_-]+)$/.exec(link.body.url)![1]!;

    const visitor = h.client('alpha.localhost');
    const ask = await visitor.post(`/api/shared/${token}/enquiry`, { name: 'Anna Muster', email: 'anna.muster@example.test', message: 'Can you deliver in March?' });
    expect(ask.status, JSON.stringify(ask.body)).toBe(200);
    const [mail] = await mailTo('support@alpha.test');
    expect(mail!.text).toContain('Reply-To: anna.muster@example.test');
    expect(mail!.text).toContain('Can you deliver in March?');

    expect((await visitor.post(`/api/shared/${token}/enquiry`, { name: 'A', email: 'not-an-email', message: 'x' })).status).toBe(422);
    expect((await visitor.post('/api/shared/not-a-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/enquiry', { name: 'A', email: 'a@example.test', message: 'x' })).status).toBeGreaterThanOrEqual(400);
  });
});
