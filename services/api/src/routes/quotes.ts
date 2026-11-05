import type { Hono } from 'hono';
import { QUOTE_FIRST_NUMBER, quoteLabel, routes } from '@saunaklar/shared';
import type { AppEnv, Ctx, Db } from '../context.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { asStaff, mount } from '../lib/route.ts';
import { getConfigRow, toConfigurationDto } from '../domain/configurations.ts';

interface ContactRow {
  id: string; person_name: string; organisation: string | null; email: string | null; mobile: string | null; notes: string | null;
  created_at: Date; updated_at: Date; quotes: string;
}
interface QuoteRow {
  id: string; number: number; version: number; unit_price_minor: string; status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED'; quantity: number; comment: string | null;
  created_at: Date; contact_id: string; configuration_id: string; person_name: string; organisation: string | null; configuration_name: string | null;
}

const CONTACT_SQL = `select c.*, (select count(*) from quotes q where q.contact_id = c.id) as quotes from contacts c`;
const QUOTE_SQL = `select q.*, c.person_name, c.organisation, cf.name as configuration_name
  from quotes q join contacts c on c.id = q.contact_id join configurations cf on cf.id = q.configuration_id`;

const contactDto = (r: ContactRow) => ({
  id: r.id, personName: r.person_name, organisation: r.organisation, email: r.email, mobile: r.mobile, notes: r.notes,
  quotes: Number(r.quotes), createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});
const quoteSummary = (r: QuoteRow) => ({
  id: r.id, number: r.number, label: quoteLabel(r.number), version: r.version, status: r.status,
  contact: { id: r.contact_id, personName: r.person_name, organisation: r.organisation },
  configuration: { id: r.configuration_id, name: r.configuration_name ?? '' },
  quantity: r.quantity, createdAt: r.created_at.toISOString(),
});

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export function registerQuotes(app: Hono<AppEnv>): void {
  const ctx = (c: Ctx) => ({ tenant: c.get('tenant')!, locale: requestLocale(c) });

  async function loadContact(db: Db, id: string): Promise<ContactRow> {
    const { rows } = await db.query<ContactRow>(`${CONTACT_SQL} where c.id = $1`, [id]);
    if (!rows[0]) throw new ApiError('NOT_FOUND', 'Contact not found.');
    return rows[0];
  }

  async function loadQuote(db: Db, c: Ctx, id: string) {
    const { tenant, locale } = ctx(c);
    const { rows } = await db.query<QuoteRow>(`${QUOTE_SQL} where q.id = $1`, [id]);
    const q = rows[0];
    if (!q) throw new ApiError('NOT_FOUND', 'Quote not found.');
    const [lines, versions, cfg] = await Promise.all([
      db.query<{ label: string; amount_minor: string }>('select label, amount_minor from quote_lines where quote_id = $1 order by position', [id]),
      db.query<{ id: string; version: number; status: QuoteRow['status']; created_at: Date }>(
        'select id, version, status, created_at from quotes where number = $1 order by version desc', [q.number]),
      getConfigRow(db, q.configuration_id, { staff: true }).then(row => toConfigurationDto(db, tenant, locale, row)),
    ]);
    const extra = lines.rows.map(l => ({ label: l.label, amountMinor: Number(l.amount_minor) }));
    const unit = Number(q.unit_price_minor);
    return {
      ...quoteSummary(q), comment: q.comment, lines: extra, currency: tenant.currency, unitPriceMinor: unit,
      totalMinor: unit * q.quantity + extra.reduce((s, l) => s + l.amountMinor, 0), sauna: cfg.sauna,
      versions: versions.rows.map(v => ({ id: v.id, version: v.version, status: v.status, createdAt: v.created_at.toISOString() })),
    };
  }

  async function insertQuote(db: Db, c: Ctx, resellerId: string, staffId: string, q: {
    number: number; version: number; contactId: string; configurationId: string; quantity: number; comment: string | null; lines: { label: string; amountMinor: number }[];
  }): Promise<string> {
    const { tenant, locale } = ctx(c);
    const cfg = await toConfigurationDto(db, tenant, locale, await getConfigRow(db, q.configurationId, { staff: true }));
    const { rows } = await db.query<{ id: string }>(
      `insert into quotes (reseller_id, number, version, contact_id, configuration_id, quantity, unit_price_minor, comment, created_by_staff_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [resellerId, q.number, q.version, q.contactId, q.configurationId, q.quantity, (cfg.snapshot ?? cfg.price).finalPriceMinor, q.comment, staffId]);
    const id = rows[0]!.id;
    for (const [i, l] of q.lines.entries()) {
      await db.query('insert into quote_lines (reseller_id, quote_id, position, label, amount_minor) values ($1, $2, $3, $4, $5)', [resellerId, id, i, l.label, l.amountMinor]);
    }
    return id;
  }

  async function assertConfiguration(db: Db, id: string): Promise<void> {
    await getConfigRow(db, id, { staff: true }); // NOT_FOUND unless it is this reseller's
  }

  mount(app, routes.adminContacts, async ({ c, query }) => {
    const q = query.q ? `%${query.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const { rows } = await tenantTx(c, db => db.query<ContactRow>(
      `${CONTACT_SQL} where ($1::text is null or c.person_name ilike $1 or c.organisation ilike $1 or c.email ilike $1 or c.mobile ilike $1)
        order by c.created_at desc, c.id desc limit 200`, [q]));
    return { items: rows.map(contactDto) };
  });

  mount(app, routes.adminCreateContact, async ({ c, body, principal }) => {
    const me = asStaff(principal);
    const { tenant } = ctx(c);
    return tenantTx(c, async db => {
      const { rows } = await db.query<{ id: string }>(
        `insert into contacts (reseller_id, person_name, organisation, email, mobile, notes, created_by_staff_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [tenant.id, body.personName, blank(body.organisation), blank(body.email), blank(body.mobile), blank(body.notes), me.staffId]);
      return contactDto(await loadContact(db, rows[0]!.id));
    });
  });

  mount(app, routes.adminContact, async ({ c, params }) => tenantTx(c, async db => contactDto(await loadContact(db, params.id!))));

  mount(app, routes.adminUpdateContact, async ({ c, params, body }) =>
    tenantTx(c, async db => {
      const cur = await loadContact(db, params.id!);
      const pick = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
      await db.query(
        'update contacts set person_name = $2, organisation = $3, email = $4, mobile = $5, notes = $6 where id = $1',
        [cur.id, pick(body.personName, cur.person_name), blank(pick(body.organisation, cur.organisation)), blank(pick(body.email, cur.email)),
          blank(pick(body.mobile, cur.mobile)), blank(pick(body.notes, cur.notes))]);
      return contactDto(await loadContact(db, cur.id));
    }));

  mount(app, routes.adminOffers, async ({ c, query }) => {
    const { rows } = await tenantTx(c, db => db.query<QuoteRow>(
      `${QUOTE_SQL} where ($1::uuid is null or q.contact_id = $1)
         and q.version = (select max(version) from quotes x where x.reseller_id = q.reseller_id and x.number = q.number)
       order by q.number desc limit 200`, [query.contactId ?? null]));
    return { items: rows.map(quoteSummary) };
  });

  mount(app, routes.adminCreateOffer, async ({ c, body, principal }) => {
    const me = asStaff(principal);
    const { tenant } = ctx(c);
    return tenantTx(c, async db => {
      await loadContact(db, body.contactId);
      await assertConfiguration(db, body.configurationId);
      // One number at a time per reseller; the unique key backs this up.
      await db.query('select pg_advisory_xact_lock(hashtextextended($1, 16))', [tenant.id]);
      const { rows } = await db.query<{ n: number }>('select coalesce(max(number), $2 - 1) + 1 as n from quotes where reseller_id = $1', [tenant.id, QUOTE_FIRST_NUMBER]);
      const id = await insertQuote(db, c, tenant.id, me.staffId, {
        number: rows[0]!.n, version: 1, contactId: body.contactId, configurationId: body.configurationId,
        quantity: body.quantity, comment: blank(body.comment), lines: body.lines,
      });
      return loadQuote(db, c, id);
    });
  });

  mount(app, routes.adminOffer, async ({ c, params }) => tenantTx(c, db => loadQuote(db, c, params.id!)));

  // A change after sending is a new version of the same number; earlier versions stay as they were.
  mount(app, routes.adminOfferVersion, async ({ c, params, body, principal }) => {
    const me = asStaff(principal);
    const { tenant } = ctx(c);
    return tenantTx(c, async db => {
      const { rows } = await db.query<QuoteRow>(`${QUOTE_SQL} where q.id = $1`, [params.id]);
      const cur = rows[0];
      if (!cur) throw new ApiError('NOT_FOUND', 'Quote not found.');
      await db.query('select pg_advisory_xact_lock(hashtextextended($1, 16))', [tenant.id]);
      const latest = await db.query<{ v: number }>('select max(version) as v from quotes where reseller_id = $1 and number = $2', [tenant.id, cur.number]);
      const configurationId = body.configurationId ?? cur.configuration_id;
      if (configurationId !== cur.configuration_id) await assertConfiguration(db, configurationId);
      const lines = body.lines ?? (await db.query<{ label: string; amount_minor: string }>('select label, amount_minor from quote_lines where quote_id = $1 order by position', [cur.id]))
        .rows.map(l => ({ label: l.label, amountMinor: Number(l.amount_minor) }));
      const id = await insertQuote(db, c, tenant.id, me.staffId, {
        number: cur.number, version: latest.rows[0]!.v + 1, contactId: cur.contact_id, configurationId,
        quantity: body.quantity ?? cur.quantity, comment: body.comment === undefined ? cur.comment : blank(body.comment), lines,
      });
      return loadQuote(db, c, id);
    });
  });

  mount(app, routes.adminOfferStatus, async ({ c, params, body }) =>
    tenantTx(c, async db => {
      const { rowCount } = await db.query('update quotes set status = $2 where id = $1', [params.id, body.status]);
      if (!rowCount) throw new ApiError('NOT_FOUND', 'Quote not found.');
      return loadQuote(db, c, params.id!);
    }));
}
