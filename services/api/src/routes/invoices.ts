import type { Hono } from 'hono';
import { INVOICE_FIRST_NUMBER, invoiceLabel, quoteLabel, routes } from '@saunaklar/shared';
import type { AppEnv, Ctx, Db } from '../context.ts';
import { tenantTx } from '../lib/db.ts';
import { ApiError } from '../lib/problem.ts';
import { asStaff, mount } from '../lib/route.ts';
import { buildInvoicePdf } from '../domain/invoicePdf.ts';

interface InvoiceRow {
  id: string; number: number; quote_id: string; contact_id: string; percent: number; quote_total_minor: string; amount_minor: string;
  status: 'ISSUED' | 'PAID' | 'CANCELLED'; issued_on: string; due_on: string; paid_at: Date | null; payment_details: string | null; note: string | null;
  quote_number: number; quote_version: number; person_name: string; organisation: string | null; email: string | null;
}
const INVOICE_SQL = `select i.id, i.number, i.quote_id, i.contact_id, i.percent, i.quote_total_minor, i.amount_minor, i.status,
    to_char(i.issued_on, 'YYYY-MM-DD') as issued_on, to_char(i.due_on, 'YYYY-MM-DD') as due_on, i.paid_at, i.payment_details, i.note,
    q.number as quote_number, q.version as quote_version, c.person_name, c.organisation, c.email
  from invoices i join quotes q on q.id = i.quote_id join contacts c on c.id = i.contact_id`;

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);

export function registerInvoices(app: Hono<AppEnv>): void {
  const toDto = (r: InvoiceRow, currency: string, today: string) => ({
    id: r.id, number: r.number, label: invoiceLabel(r.number), status: r.status,
    quote: { id: r.quote_id, label: quoteLabel(r.quote_number), version: r.quote_version },
    contact: { id: r.contact_id, personName: r.person_name, organisation: r.organisation },
    percent: r.percent, amountMinor: Number(r.amount_minor), currency, issuedOn: r.issued_on, dueOn: r.due_on,
    overdue: r.status === 'ISSUED' && r.due_on < today,
    quoteTotalMinor: Number(r.quote_total_minor), paidAt: r.paid_at?.toISOString() ?? null, paymentDetails: r.payment_details, note: r.note,
  });
  const env = (c: Ctx) => ({ tenant: c.get('tenant')!, today: day(c.get('deps').now()) });

  async function load(db: Db, id: string): Promise<InvoiceRow> {
    const { rows } = await db.query<InvoiceRow>(`${INVOICE_SQL} where i.id = $1`, [id]);
    if (!rows[0]) throw new ApiError('NOT_FOUND', 'Invoice not found.');
    return rows[0];
  }

  mount(app, routes.adminInvoices, async ({ c, query }) => {
    const { tenant, today } = env(c);
    const { rows } = await tenantTx(c, db => db.query<InvoiceRow>(
      `${INVOICE_SQL} where ($1::uuid is null or i.quote_id = $1) and ($2::text is null or i.status = $2) order by i.number desc limit 200`,
      [query.quoteId ?? null, query.status ?? null]));
    return { items: rows.map(r => toDto(r, tenant.currency, today)) };
  });

  mount(app, routes.adminCreateInvoice, async ({ c, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, today } = env(c);
    return tenantTx(c, async db => {
      const q = await db.query<{ id: string; number: number; version: number; status: string; contact_id: string; unit_price_minor: string; quantity: number }>(
        'select id, number, version, status, contact_id, unit_price_minor, quantity from quotes where id = $1', [body.quoteId]);
      const quote = q.rows[0];
      if (!quote) throw new ApiError('NOT_FOUND', 'Quote not found.');
      if (quote.status !== 'ACCEPTED') throw new ApiError('CONFLICT', 'Only an accepted quote can be invoiced.');
      const newest = await db.query<{ v: number }>('select max(version) as v from quotes where reseller_id = $1 and number = $2', [tenant.id, quote.number]);
      if (newest.rows[0]!.v !== quote.version) throw new ApiError('CONFLICT', 'This is not the newest version of the quote.');
      const lines = await db.query<{ s: string }>('select coalesce(sum(amount_minor), 0) as s from quote_lines where quote_id = $1', [quote.id]);
      const total = Number(quote.unit_price_minor) * quote.quantity + Number(lines.rows[0]!.s);
      const amount = Math.round((total * body.percent) / 100);
      await db.query('select pg_advisory_xact_lock(hashtextextended($1, 17))', [tenant.id]);
      const n = await db.query<{ n: number }>('select coalesce(max(number), $2 - 1) + 1 as n from invoices where reseller_id = $1', [tenant.id, INVOICE_FIRST_NUMBER]);
      const due = new Date(Date.parse(`${today}T00:00:00Z`) + body.dueInDays * 86_400_000);
      const ins = await db.query<{ id: string }>(
        `insert into invoices (reseller_id, number, quote_id, contact_id, percent, quote_total_minor, amount_minor, issued_on, due_on, payment_details, note, created_by_staff_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [tenant.id, n.rows[0]!.n, quote.id, quote.contact_id, body.percent, total, amount, today, day(due), blank(body.paymentDetails), blank(body.note), me.staffId]);
      return toDto(await load(db, ins.rows[0]!.id), tenant.currency, today);
    });
  });

  mount(app, routes.adminInvoice, async ({ c, params }) => {
    const { tenant, today } = env(c);
    return tenantTx(c, async db => toDto(await load(db, params.id!), tenant.currency, today));
  });

  mount(app, routes.adminInvoiceStatus, async ({ c, params, body }) => {
    const { tenant, today } = env(c);
    return tenantTx(c, async db => {
      const cur = await load(db, params.id!);
      if (cur.status === 'CANCELLED' && body.status !== 'CANCELLED') throw new ApiError('CONFLICT', 'A cancelled invoice stays cancelled.');
      await db.query('update invoices set status = $2, paid_at = case when $2 = \'PAID\' then coalesce(paid_at, now()) else null end where id = $1', [params.id, body.status]);
      return toDto(await load(db, params.id!), tenant.currency, today);
    });
  });

  mount(app, routes.adminInvoicePdf, async ({ c, params }) => {
    const { tenant } = env(c);
    const data = await tenantTx(c, async db => {
      const r = await load(db, params.id!);
      const br = await db.query<{ display_name: string; legal_name: string | null; legal_address: string | null; support_phone: string | null; support_email: string | null; vat_display: 'INCLUDED' | 'EXCLUDED' | 'NONE' }>(
        'select display_name, legal_name, legal_address, support_phone, support_email, vat_display from reseller_branding where reseller_id = $1', [tenant.id]);
      const b = br.rows[0];
      return {
        shop: { name: b?.display_name ?? 'Shop', legalName: b?.legal_name ?? null, address: b?.legal_address ?? null, phone: b?.support_phone ?? null, email: b?.support_email ?? null },
        vat: b?.vat_display ?? ('INCLUDED' as const), label: invoiceLabel(r.number), quoteLabel: quoteLabel(r.quote_number), status: r.status,
        issuedOn: r.issued_on, dueOn: r.due_on, contact: { personName: r.person_name, organisation: r.organisation, email: r.email },
        currency: tenant.currency, percent: r.percent, quoteTotalMinor: Number(r.quote_total_minor), amountMinor: Number(r.amount_minor),
        paymentDetails: r.payment_details, note: r.note,
      };
    });
    const bytes = await buildInvoicePdf(data);
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${data.label}.pdf"`, 'Cache-Control': 'no-store' },
    });
  });
}
