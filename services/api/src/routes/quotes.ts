import type { Hono } from 'hono';
import { QUOTE_FIRST_NUMBER, quoteLabel, routes } from '@saunaklar/shared';
import type { AppEnv, Ctx, Db } from '../context.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { asStaff, mount } from '../lib/route.ts';
import { getConfigRow, lockConfiguration, toConfigurationDto } from '../domain/configurations.ts';
import { scoreShare } from '../domain/likelihood.ts';
import { loadModel } from '../domain/catalog.ts';
import { buildOfferPdf } from '../domain/offerPdf.ts';
import { loadMailBrand } from '../domain/mailBrand.ts';
import { hashShareToken, newShareToken } from '../domain/sharing.ts';
import { templates } from '../adapters/mail/templates.ts';
import { watermarkImage } from '../domain/watermark.ts';

interface ContactRow {
  id: string; person_name: string; organisation: string | null; email: string | null; mobile: string | null; notes: string | null;
  created_at: Date; updated_at: Date; quotes: string;
}
interface QuoteRow {
  id: string; number: number; version: number; unit_price_minor: string; status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED'; quantity: number; comment: string | null;
  created_at: Date; contact_id: string; configuration_id: string; person_name: string; organisation: string | null; configuration_name: string | null;
  opens: string; last_opened_at: Date | null;
}

const CONTACT_SQL = `select c.*, (select count(*) from quotes q where q.contact_id = c.id) as quotes from contacts c`;
// opens / lastOpenedAt count the views of every customer link of the quote's configuration: the shop may
// have re-sent the link, and the customer may open an older one.
const QUOTE_SQL = `select q.*, c.person_name, c.organisation, cf.name as configuration_name,
    (select count(*) from share_link_views v join share_links s on s.id = v.share_link_id where s.configuration_id = q.configuration_id) as opens,
    (select max(v.viewed_at) from share_link_views v join share_links s on s.id = v.share_link_id where s.configuration_id = q.configuration_id) as last_opened_at
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
  opens: Number(r.opens), lastOpenedAt: r.last_opened_at ? r.last_opened_at.toISOString() : null,
});

/** Allowed status changes. ACCEPTED and DECLINED are final; a change after that is a new version. */
const STATUS_NEXT: Record<QuoteRow['status'], QuoteRow['status'][]> = {
  DRAFT: ['SENT', 'ACCEPTED', 'DECLINED'],
  SENT: ['DRAFT', 'ACCEPTED', 'DECLINED'],
  ACCEPTED: [],
  DECLINED: [],
};

const validUntilOf = (price: object): Date | null => {
  const raw = (price as { priceValidUntil?: unknown }).priceValidUntil;
  const d = raw ? new Date(String(raw)) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

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
      getConfigRow(db, q.configuration_id).then(row => toConfigurationDto(db, tenant, locale, row)),
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
    const cfg = await toConfigurationDto(db, tenant, locale, await getConfigRow(db, q.configurationId));
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
    await getConfigRow(db, id); // NOT_FOUND unless it is this reseller's
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
         and ($2::int is null or q.number = $2)
         and (not $3::boolean or q.status in ('DRAFT', 'SENT'))
         and q.version = (select max(version) from quotes x where x.reseller_id = q.reseller_id and x.number = q.number)
       order by q.number desc limit 200`, [query.contactId ?? null, query.number ?? null, query.open === '1']));
    return { items: rows.map(quoteSummary) };
  });

  // Numbers for the reports page; every figure counts the newest version of each quote number.
  mount(app, routes.adminReports, async ({ c }) => {
    const now = c.get('deps').now();
    c.header('Cache-Control', 'no-store');
    const newest = `q.version = (select max(version) from quotes x where x.reseller_id = q.reseller_id and x.number = q.number)`;
    const newestLink = `l.id = (select s.id from share_links s where s.configuration_id = q.configuration_id order by s.created_at desc limit 1)`;
    return tenantTx(c, async db => {
      const [status, models, links, expiring] = await Promise.all([
        db.query<{ status: QuoteRow['status']; n: string }>(`select q.status, count(*) as n from quotes q where ${newest} group by q.status`),
        db.query<{ name: string; n: string }>(
          `select m.name, count(*) as n from quotes q
             join configurations cf on cf.id = q.configuration_id join sauna_models m on m.id = cf.sauna_model_id
            where ${newest} group by m.name order by n desc, m.name limit 6`),
        db.query<{ shared: string; opened: string; last7: string; inside: string }>(
          `with ql as (select l.id from share_links l where exists (select 1 from quotes q where q.configuration_id = l.configuration_id))
           select (select count(*) from ql) as shared,
                  (select count(*) from ql where exists (select 1 from share_link_views v where v.share_link_id = ql.id)) as opened,
                  (select count(*) from share_link_views v where v.share_link_id in (select id from ql) and v.viewed_at > $1::timestamptz - interval '7 days') as last7,
                  (select count(*) from share_link_activity a where a.share_link_id in (select id from ql) and a.inside_view) as inside`, [now]),
        db.query<{ id: string; number: number; person_name: string; expires_at: Date; opened: boolean }>(
          `select q.id, q.number, c.person_name, l.expires_at,
                  exists (select 1 from share_link_views v join share_links s on s.id = v.share_link_id where s.configuration_id = q.configuration_id) as opened
             from quotes q join contacts c on c.id = q.contact_id join share_links l on l.configuration_id = q.configuration_id
            where ${newest} and ${newestLink} and q.status in ('DRAFT', 'SENT')
              and l.revoked_at is null and l.expires_at > $1::timestamptz
              and (l.expires_at < $1::timestamptz + interval '7 days' or not exists (select 1 from share_link_views v join share_links s on s.id = v.share_link_id where s.configuration_id = q.configuration_id))
            order by l.expires_at limit 20`, [now]),
      ]);
      const count = (st: QuoteRow['status']) => Number(status.rows.find(r => r.status === st)?.n ?? 0);
      const sent = count('SENT') + count('ACCEPTED') + count('DECLINED');
      const l = links.rows[0]!;
      return {
        quotesByStatus: (['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED'] as const).map(st => ({ status: st, count: count(st) })),
        conversion: { sent, accepted: count('ACCEPTED'), percent: sent ? Math.round((count('ACCEPTED') / sent) * 100) : null },
        topModels: models.rows.map(m => ({ name: m.name, quotes: Number(m.n) })),
        linkActivity: { linksShared: Number(l.shared), linksOpened: Number(l.opened), opensLast7Days: Number(l.last7), insideViews: Number(l.inside) },
        expiring: expiring.rows.map(r => ({ offerId: r.id, label: quoteLabel(r.number), contactName: r.person_name, expiresAt: r.expires_at.toISOString(), opened: r.opened })),
      };
    });
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
      const { rows } = await db.query<{ status: QuoteRow['status']; version: number; newest: number }>(
        `select q.status, q.version, (select max(x.version) from quotes x where x.reseller_id = q.reseller_id and x.number = q.number) as newest
           from quotes q where q.id = $1 for update`, [params.id]);
      const cur = rows[0];
      if (!cur) throw new ApiError('NOT_FOUND', 'Quote not found.');
      if (cur.version !== cur.newest) throw new ApiError('CONFLICT', 'This is an older version of the quote. Change the status on the newest version.');
      if (cur.status !== body.status && !STATUS_NEXT[cur.status].includes(body.status)) {
        throw new ApiError('CONFLICT', `A ${cur.status.toLowerCase()} quote cannot become ${body.status.toLowerCase()}. Make a new version instead.`);
      }
      await db.query('update quotes set status = $2 where id = $1', [params.id, body.status]);
      return loadQuote(db, c, params.id!);
    }));

  // What the customer did with the share link of this quote's configuration, and the score.
  mount(app, routes.adminOfferTracking, async ({ c, params }) => {
    const now = c.get('deps').now();
    c.header('Cache-Control', 'no-store');
    return tenantTx(c, async db => {
      const q = await db.query<{ configuration_id: string }>('select configuration_id from quotes where id = $1', [params.id]);
      if (!q.rows[0]) throw new ApiError('NOT_FOUND', 'Quote not found.');
      const { rows: links } = await db.query<{ id: string; created_at: Date; expires_at: Date; revoked_at: Date | null }>(
        'select id, created_at, expires_at, revoked_at from share_links where configuration_id = $1 order by created_at desc limit 1', [q.rows[0].configuration_id]);
      const link = links[0];
      const empty = { opens: 0, lastOpenedAt: null, visitors: 0, insideViewOpened: false, longestVisitSeconds: 0, recent: [] };
      if (!link) return { link: null, ...empty, score: { points: 0, level: 'NONE' as const, reasons: [] } };
      const [views, activity, total] = await Promise.all([
        db.query<{ viewed_at: Date; device_class: 'MOBILE' | 'TABLET' | 'DESKTOP' | 'OTHER'; ip_prefix: string | null; user_agent: string | null }>(
          'select viewed_at, device_class, ip_prefix, user_agent from share_link_views where share_link_id in (select id from share_links where configuration_id = $1) order by viewed_at desc limit 500', [q.rows[0].configuration_id]),
        db.query<{ inside_view: boolean; seconds: number }>('select inside_view, seconds from share_link_activity where share_link_id in (select id from share_links where configuration_id = $1)', [q.rows[0].configuration_id]),
        db.query<{ n: string }>('select count(*) as n from share_link_views where share_link_id in (select id from share_links where configuration_id = $1)', [q.rows[0].configuration_id]),
      ]);
      const visitorOf = (v: { ip_prefix: string | null; user_agent: string | null }) => (v.ip_prefix || v.user_agent ? `${v.ip_prefix ?? ''}|${v.user_agent ?? ''}` : null);
      const score = scoreShare({
        sentAt: link.created_at, expiresAt: link.expires_at, now,
        views: views.rows.map(v => ({ viewedAt: v.viewed_at, visitor: visitorOf(v) })),
        activity: activity.rows.map(a => ({ insideView: a.inside_view, seconds: a.seconds })),
      });
      return {
        link: { id: link.id, createdAt: link.created_at.toISOString(), expiresAt: link.expires_at.toISOString(), revoked: link.revoked_at !== null },
        opens: Number(total.rows[0]!.n),
        lastOpenedAt: views.rows[0]?.viewed_at.toISOString() ?? null,
        visitors: new Set(views.rows.map(visitorOf).filter(Boolean)).size,
        insideViewOpened: activity.rows.some(a => a.inside_view),
        longestVisitSeconds: Math.max(0, ...activity.rows.map(a => a.seconds)),
        recent: views.rows.slice(0, 20).map(v => ({ viewedAt: v.viewed_at.toISOString(), device: v.device_class, network: v.ip_prefix })),
        score,
      };
    });
  });

  // One PDF per quote version, built on the server and watermarked there.
  /** Everything the offer PDF (and the offer e-mail) shows, read in one transaction. */
  async function offerPdfData(c: Ctx, id: string) {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const o = await loadQuote(db, c, id);
      const [cu, br, cfgRow] = await Promise.all([
        db.query<{ person_name: string; organisation: string | null; email: string | null; mobile: string | null }>('select person_name, organisation, email, mobile from contacts where id = $1', [o.contact.id]),
        db.query<{ display_name: string; legal_name: string | null; legal_address: string | null; support_phone: string | null; support_email: string | null; vat_display: 'INCLUDED' | 'EXCLUDED' | 'NONE' }>(
          'select display_name, legal_name, legal_address, support_phone, support_email, vat_display from reseller_branding where reseller_id = $1', [tenant.id]),
        getConfigRow(db, o.configuration.id),
      ]);
      const cfg = await toConfigurationDto(db, tenant, locale, cfgRow);
      const model = await loadModel(db, tenant, locale, { id: cfgRow.sauna_model_id }, true);
      const price = cfg.snapshot ?? cfg.price;
      const delta = new Map(price.lines.map(l => [l.optionId, l.priceDeltaMinor]));
      const options = (model?.detail.groups ?? []).flatMap(g => g.options.filter(x => cfg.selections.includes(x.id)).map(x => ({ group: g.name, name: x.name, priceMinor: delta.get(x.id) ?? x.priceDeltaMinor })));
      const row = cu.rows[0]!;
      const b = br.rows[0];
      return {
        quoteId: o.id, configurationId: o.configuration.id,
        shop: { name: b?.display_name ?? 'Shop', legalName: b?.legal_name ?? null, address: b?.legal_address ?? null, phone: b?.support_phone ?? null, email: b?.support_email ?? null },
        vat: b?.vat_display ?? 'INCLUDED' as const, label: o.label, version: o.version, createdAt: new Date(o.createdAt),
        contact: { personName: row.person_name, organisation: row.organisation, email: row.email, mobile: row.mobile },
        sauna: o.sauna.name, configuration: o.configuration.name, options, currency: o.currency,
        listPriceMinor: price.listPriceMinor, discountMinor: price.discountMinor, unitPriceMinor: o.unitPriceMinor, quantity: o.quantity,
        lines: o.lines, totalMinor: o.totalMinor, comment: o.comment, validUntil: validUntilOf(price),
      };
    });
  }

  mount(app, routes.adminOfferPdf, async ({ c, params }) => {
    const data = await offerPdfData(c, params.id!);
    const bytes = await buildOfferPdf(data);
    return new Response(bytes as BodyInit, {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${data.label}-v${data.version}.pdf"`, 'Cache-Control': 'no-store' },
    });
  });

  // The customer receives the quote by e-mail: summary, the PDF attached, a view-only link to the sauna in 3D.
  mount(app, routes.adminSendOffer, async ({ c, params, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, locale } = ctx(c);
    const { deps } = { deps: c.get('deps') };
    const data = await offerPdfData(c, params.id!);
    const to = data.contact.email;
    if (!to) throw new ApiError('VALIDATION_FAILED', 'This contact has no e-mail address yet.', { errors: { email: ['required'] } });

    // A new customer link for this sauna (it locks the configuration at its price); only its hash is stored.
    const token = newShareToken();
    const link = await tenantTx(c, async db => {
      const row = await getConfigRow(db, data.configurationId);
      await lockConfiguration(db, tenant, locale, row, deps.config.SHARE_PRICE_VALID_DAYS);
      const { rows: s } = await db.query<{ d: number }>('select default_share_expiry_days as d from resellers where id = $1', [tenant.id]);
      const { rows } = await db.query<{ id: string; expires_at: Date }>(
        `insert into share_links (reseller_id, configuration_id, token_hash, created_by_staff_id, expires_at)
         values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id, expires_at`,
        [tenant.id, row.id, hashShareToken(token), me.staffId, body.expiresInDays ?? s[0]!.d]);
      return { expiresAt: rows[0]!.expires_at, brand: await loadMailBrand(db, c) };
    });

    const mailLocale = body.locale ?? locale;
    const mail = templates.offerSent(link.brand, {
      firstName: data.contact.personName.split(/\s+/)[0] ?? null,
      label: data.label,
      saunaName: data.sauna,
      total: { amountMinor: data.totalMinor, currency: data.currency },
      validUntil: data.validUntil ?? link.expiresAt,
      comment: body.message || data.comment,
      viewUrl: `${link.brand.storefrontUrl}/s/${token}`,
    }, mailLocale);
    const pdf = await buildOfferPdf(data);
    try {
      await deps.adapters.mailer.send({
        to, subject: mail.subject, html: mail.html, text: mail.text, resellerId: tenant.id, fromName: link.brand.brandName,
        ...(link.brand.supportEmail ? { replyTo: link.brand.supportEmail } : {}),
        attachments: [{ filename: `${data.label}-v${data.version}.pdf`, contentBase64: Buffer.from(pdf).toString('base64') }],
      });
    } catch (err) {
      deps.log.error('offer.mail_failed', { quoteId: data.quoteId, error: err instanceof Error ? err.message : String(err) });
      throw new ApiError('INTERNAL', 'The e-mail could not be sent. Nothing was changed; try again in a moment.', { status: 502 });
    }
    return tenantTx(c, async db => {
      await db.query("update quotes set status = 'SENT' where id = $1 and status = 'DRAFT'", [data.quoteId]);
      return loadQuote(db, c, data.quoteId);
    });
  });

  // A picture from the 3D view comes back stamped; the stamp is made here, not in the browser.
  mount(app, routes.adminWatermarkImage, async ({ c, body }) => {
    const raw = body.image.replace(/^data:image\/(?:png|jpe?g);base64,/, '');
    const png = await watermarkImage(Buffer.from(raw, 'base64'), body.label);
    c.header('Cache-Control', 'no-store');
    return { contentType: 'image/png' as const, dataBase64: png.toString('base64') };
  });
}
