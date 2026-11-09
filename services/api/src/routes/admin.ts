import type { Hono } from 'hono';
import { calculatePrice, type Discount } from '@saunaklar/pricing';
import { UPLOAD_LIMITS, routes, type AdminSauna, type AdminSaunaOptions, type StorefrontLayout } from '@saunaklar/shared';
import { processBrandingUpload } from '../adapters/images.ts';
import { originFor } from '../config.ts';
import type { AppEnv, Ctx, Db, TenantInfo } from '../context.ts';
import { shareCacheKeyOfHash } from '../lib/shareLinkCache.ts';
import { hmac, randomToken, safeEqual } from '../lib/crypto.ts';
import { decodeCursor, pageOf } from '../lib/cursor.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { asStaff, mount } from '../lib/route.ts';
import { assetUrl, effectiveOptionPrice } from '../domain/catalog.ts';
import {
  createConfiguration, getConfigRow, listConfigurationSummaries, lockConfiguration, replacePlacement, replaceSelections, toConfigurationDto,
} from '../domain/configurations.ts';
import { hashShareToken, newShareToken, shareCacheOf, shareState } from '../domain/sharing.ts';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const UPLOAD_TTL_SECONDS = 600;

// ---- branding ---------------------------------------------------------------

interface BrandingRow {
  display_name: string; tagline: string | null; primary_color: string; logo: string | null; favicon: string | null;
  support_email: string | null; support_phone: string | null; legal_name: string | null; legal_address: string | null;
  vat_display: 'INCLUDED' | 'EXCLUDED' | 'NONE'; storefront_layout: StorefrontLayout;
}

async function loadBranding(db: Db, tenant: TenantInfo) {
  const { rows } = await db.query<BrandingRow>(
    `select b.display_name, b.tagline, b.primary_color, l.storage_key as logo, f.storage_key as favicon,
            b.support_email, b.support_phone, b.legal_name, b.legal_address, b.vat_display, b.storefront_layout
       from reseller_branding b
       left join assets l on l.id = b.logo_asset_id
       left join assets f on f.id = b.favicon_asset_id
      where b.reseller_id = $1`, [tenant.id]);
  const b = rows[0];
  if (!b) {
    const { rows: r } = await db.query<{ name: string }>('select name from resellers where id = $1', [tenant.id]);
    return {
      displayName: r[0]?.name ?? tenant.slug, tagline: null, primaryColor: '#9a4a24', logoUrl: null, faviconUrl: null,
      supportEmail: null, supportPhone: null, legalName: null, legalAddress: null, vatDisplay: 'INCLUDED' as const,
      storefrontLayout: 'atelier' as const,
    };
  }
  return {
    displayName: b.display_name, tagline: b.tagline, primaryColor: b.primary_color.trim(), logoUrl: assetUrl(b.logo), faviconUrl: assetUrl(b.favicon),
    supportEmail: b.support_email, supportPhone: b.support_phone, legalName: b.legal_name, legalAddress: b.legal_address, vatDisplay: b.vat_display,
    storefrontLayout: b.storefront_layout,
  };
}

/** Creates the branding row on first edit, so every later write is a plain update. */
async function ensureBranding(db: Db, tenant: TenantInfo): Promise<void> {
  await db.query(
    `insert into reseller_branding (reseller_id, display_name, storefront_layout)
     select r.id, r.name, 'atelier' from resellers r where r.id = $1
     on conflict (reseller_id) do nothing`, [tenant.id]);
}

/**
 * Upload ids are signed, self-contained tickets, so no table is needed for
 * half-finished uploads: the staging key, kind, declared type and expiry are
 * bound to the reseller by an HMAC.
 */
interface UploadTicket { k: string; kind: 'LOGO' | 'FAVICON'; ct: string; r: string; exp: number }

function signTicket(secret: string, t: UploadTicket): string {
  const body = Buffer.from(JSON.stringify(t)).toString('base64url');
  return `${body}.${hmac(secret, `upload:${body}`).slice(0, 32)}`;
}

function readTicket(secret: string, raw: string, resellerId: string, now: Date): UploadTicket {
  const [body, sig] = raw.split('.');
  if (!body || !sig || !safeEqual(sig, hmac(secret, `upload:${body}`).slice(0, 32))) throw new ApiError('NOT_FOUND', 'Unknown upload.');
  const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as UploadTicket;
  if (t.r !== resellerId) throw new ApiError('NOT_FOUND', 'Unknown upload.');
  if (t.exp < now.getTime()) throw new ApiError('GONE', 'The upload window has closed. Start again.');
  return t;
}

// ---- saunas and discounts -----------------------------------------------------

const discountOf = (type: string | null, value: string | null): Discount | null =>
  type ? { type: type as Discount['type'], value: Number(value) } : null;

async function adminSaunas(db: Db, tenant: TenantInfo, locale: string, onlyId?: string) {
  const { rows } = await db.query<{
    id: string; slug: string; name: string; thumb: string | null; is_visible: boolean; sort_order: number;
    list_price_minor: string; max_discount_bps: number; s_type: string | null; s_value: string | null; d_type: string | null; d_value: string | null;
  }>(
    `select m.id, m.slug, coalesce(t.name, m.name) as name,
            (select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id
              where x.sauna_model_id = m.id and x.asset_role = 'MODEL_THUMBNAIL' order by x.position limit 1) as thumb,
            rs.is_visible, rs.sort_order, p.list_price_minor, p.max_discount_bps,
            d.discount_type as s_type, d.discount_value as s_value, dd.discount_type as d_type, dd.discount_value as d_value
       from reseller_saunas rs
       join sauna_models m on m.id = rs.sauna_model_id
       join sauna_model_prices p on p.sauna_model_id = m.id and p.currency_code = $2
       left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $3
       left join reseller_sauna_discounts d on d.reseller_id = rs.reseller_id and d.sauna_model_id = m.id
       left join reseller_default_discounts dd on dd.reseller_id = rs.reseller_id
      where rs.reseller_id = $1 and ($4::uuid is null or m.id = $4)
      order by rs.sort_order, name`,
    [tenant.id, tenant.currency, locale, onlyId ?? null]);
  const defaultDiscount = rows[0] ? discountOf(rows[0].d_type, rows[0].d_value) : await loadDefaultDiscount(db, tenant);
  const items: AdminSauna[] = rows.map(r => {
    const own = discountOf(r.s_type, r.s_value);
    // Review G5: the effective discount is what the customer actually gets, after the cap.
    const p = calculatePrice({ listPriceMinor: Number(r.list_price_minor), maxDiscountBps: r.max_discount_bps, perSaunaDiscount: own, defaultDiscount, options: [] });
    return {
      id: r.id, slug: r.slug, name: r.name, thumbnailUrl: assetUrl(r.thumb), isVisible: r.is_visible, sortOrder: r.sort_order,
      listPriceMinor: Number(r.list_price_minor), maxDiscountBps: r.max_discount_bps, discount: own,
      effectiveDiscount: p.discountMinor > 0 ? { type: 'FIXED', value: p.discountMinor } : null,
      priceFromMinor: p.finalPriceMinor,
    };
  });
  return { items, defaultDiscount };
}

async function loadDefaultDiscount(db: Db, tenant: TenantInfo): Promise<Discount | null> {
  const { rows } = await db.query<{ discount_type: string; discount_value: string }>('select discount_type, discount_value from reseller_default_discounts where reseller_id = $1', [tenant.id]);
  return rows[0] ? discountOf(rows[0].discount_type, rows[0].discount_value) : null;
}

async function oneSauna(db: Db, tenant: TenantInfo, locale: string, id: string): Promise<AdminSauna> {
  const { items } = await adminSaunas(db, tenant, locale, id);
  if (!items[0]) throw new ApiError('NOT_FOUND', 'This sauna is not assigned to you.');
  return items[0];
}

// ---- per-sauna option settings (0015) -------------------------------------------

/** Every option of an assigned sauna with the reseller's setting and the effective values. */
async function saunaOptions(db: Db, tenant: TenantInfo, locale: string, saunaId: string): Promise<AdminSaunaOptions> {
  const assigned = await db.query('select 1 from reseller_saunas where reseller_id = $1 and sauna_model_id = $2', [tenant.id, saunaId]);
  if (!assigned.rowCount) throw new ApiError('NOT_FOUND', 'This sauna is not assigned to you.');
  const [{ rows }, requires] = await Promise.all([
    db.query<{
      group_id: string; group_code: string; group_name: string; selection_type: 'SINGLE' | 'MULTI'; is_required: boolean;
      option_id: string; option_code: string; option_name: string; option_description: string | null; is_default: boolean;
      price_delta_minor: string | null; is_enabled: boolean | null; price_override_minor: string | null; description_override: string | null;
    }>(
      `select g.id as group_id, g.code as group_code, coalesce(gt.name, g.name) as group_name, g.selection_type, smg.is_required,
              o.id as option_id, o.code as option_code, coalesce(ot.name, o.name) as option_name,
              coalesce(ot.description, o.description) as option_description, smo.is_default, op.price_delta_minor,
              rso.is_enabled, rso.price_override_minor, rso.description_override
         from sauna_model_option_groups smg
         join option_groups g on g.id = smg.option_group_id
         left join option_group_translations gt on gt.option_group_id = g.id and gt.locale = $3
         join sauna_model_options smo on smo.sauna_model_id = smg.sauna_model_id and smo.option_group_id = g.id
         join options o on o.id = smo.option_id
         left join option_translations ot on ot.option_id = o.id and ot.locale = $3
         left join sauna_model_option_prices op on op.sauna_model_id = smo.sauna_model_id and op.option_id = o.id and op.currency_code = $4
         left join reseller_sauna_options rso on rso.reseller_id = $2 and rso.sauna_model_id = smo.sauna_model_id and rso.option_id = o.id
        where smg.sauna_model_id = $1
        order by smg.sort_order, g.sort_order, g.code, o.sort_order, o.code`,
      [saunaId, tenant.id, locale, tenant.currency]),
    db.query<{ option_id: string; required_option_id: string }>('select option_id, required_option_id from option_requires where sauna_model_id = $1', [saunaId]),
  ]);
  const groups = new Map<string, AdminSaunaOptions['groups'][number]>();
  for (const r of rows) {
    let g = groups.get(r.group_id);
    if (!g) groups.set(r.group_id, (g = { id: r.group_id, code: r.group_code, name: r.group_name, selectionType: r.selection_type, required: r.is_required, options: [] }));
    const base = Number(r.price_delta_minor ?? 0);
    const override = r.price_override_minor === null ? null : Number(r.price_override_minor);
    g.options.push({
      id: r.option_id, code: r.option_code, name: r.option_name, description: r.option_description, isDefault: r.is_default,
      enabled: r.is_enabled ?? true, basePriceMinor: base, priceOverrideMinor: override,
      effectivePriceMinor: effectiveOptionPrice(base, override), descriptionOverride: r.description_override,
    });
  }
  return {
    saunaModelId: saunaId,
    currency: tenant.currency,
    groups: [...groups.values()],
    requires: requires.rows.map(r => ({ optionId: r.option_id, requiredOptionId: r.required_option_id })),
  };
}

type OptionSettingInput = { optionId: string; enabled: boolean; priceOverrideMinor: number | null; descriptionOverride: string | null };

/**
 * Checks the end state of a settings change before writing it (the database trigger repeats the
 * two option rules): every option belongs to the sauna, a required group keeps an enabled option,
 * and no enabled option requires a disabled one.
 */
export function checkOptionSettings(current: AdminSaunaOptions, changes: readonly OptionSettingInput[]): void {
  const errors: Record<string, string[]> = {};
  const all = new Map(current.groups.flatMap(g => g.options.map(o => [o.id, o] as const)));
  const enabled = new Map([...all.values()].map(o => [o.id, o.enabled]));
  const seen = new Set<string>();
  changes.forEach((c, i) => {
    if (!all.has(c.optionId)) errors[`options.${i}.optionId`] = ['This option is not offered with this sauna.'];
    if (seen.has(c.optionId)) errors[`options.${i}.optionId`] = ['Each option may appear once.'];
    seen.add(c.optionId);
    enabled.set(c.optionId, c.enabled);
  });
  if (Object.keys(errors).length) throw new ApiError('VALIDATION_FAILED', 'Some options are not offered with this sauna.', { errors });
  const index = (id: string) => changes.findIndex(c => c.optionId === id);
  for (const g of current.groups) {
    if (g.required && g.options.every(o => enabled.get(o.id) === false)) {
      const i = changes.findIndex(c => g.options.some(o => o.id === c.optionId));
      errors[`options.${i}.enabled`] = [`${g.name} is required: keep at least one option enabled.`];
    }
  }
  for (const r of current.requires) {
    if (enabled.get(r.optionId) !== false && enabled.get(r.requiredOptionId) === false) {
      const i = Math.max(index(r.requiredOptionId), index(r.optionId));
      errors[`options.${i}.enabled`] = [`${all.get(r.optionId)?.name ?? r.optionId} requires ${all.get(r.requiredOptionId)?.name ?? r.requiredOptionId}: disable both or neither.`];
    }
  }
  if (Object.keys(errors).length) {
    throw new ApiError('OPTION_RULES_VIOLATED', Object.values(errors).flat().join(' '), { errors });
  }
}

function checkDiscount(d: Discount): void {
  if (d.type === 'PERCENT' && d.value > 10_000) throw new ApiError('VALIDATION_FAILED', 'A percentage is at most 100 %.', { errors: { value: ['At most 10000 basis points.'] } });
}

// ---- share links ---------------------------------------------------------------

interface LinkRow { id: string; configuration_id: string; expires_at: Date; revoked_at: Date | null; created_at: Date; views: string; last_viewed_at: Date | null }

const LINK_SQL = `
  select s.id, s.configuration_id, s.expires_at, s.revoked_at, s.created_at,
         (select count(*) from share_link_views v where v.share_link_id = s.id) as views,
         (select max(v.viewed_at) from share_link_views v where v.share_link_id = s.id) as last_viewed_at
    from share_links s`;

const linkOf = (r: LinkRow, now: Date) => ({
  id: r.id, configurationId: r.configuration_id, expiresAt: r.expires_at.toISOString(), revokedAt: iso(r.revoked_at),
  createdAt: r.created_at.toISOString(), views: Number(r.views), lastViewedAt: iso(r.last_viewed_at), state: shareState(r, now),
});

// ---- routes -----------------------------------------------------------------------

/** Reseller admin panel API on `{slug}.<domain>/admin` (design 8.2). RLS limits everything to the tenant. */
export function registerAdmin(app: Hono<AppEnv>): void {
  const ctx = (c: Ctx) => ({ tenant: c.get('tenant')!, locale: requestLocale(c), deps: c.get('deps') });

  // branding
  mount(app, routes.adminBranding, async ({ c }) => tenantTx(c, db => loadBranding(db, c.get('tenant')!)));

  mount(app, routes.adminPatchBranding, async ({ c, body }) => {
    const { tenant } = ctx(c);
    return tenantTx(c, async db => {
      await ensureBranding(db, tenant);
      const sets: string[] = [];
      const vals: unknown[] = [tenant.id];
      const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (body.displayName !== undefined) set('display_name', body.displayName);
      if (body.tagline !== undefined) set('tagline', body.tagline || null);
      if (body.primaryColor !== undefined) set('primary_color', body.primaryColor.toLowerCase());
      if (body.supportEmail !== undefined) set('support_email', body.supportEmail || null);
      if (body.supportPhone !== undefined) set('support_phone', body.supportPhone || null);
      if (body.legalName !== undefined) set('legal_name', body.legalName || null);
      if (body.legalAddress !== undefined) set('legal_address', body.legalAddress || null);
      if (body.vatDisplay !== undefined) set('vat_display', body.vatDisplay);
      if (body.storefrontLayout !== undefined) set('storefront_layout', body.storefrontLayout);
      if (sets.length) await db.query(`update reseller_branding set ${sets.join(', ')}, updated_at = now() where reseller_id = $1`, vals);
      return loadBranding(db, tenant);
    });
  });

  mount(app, routes.adminCreateUpload, async ({ c, body }) => {
    const { tenant, deps } = ctx(c);
    const limits = UPLOAD_LIMITS[body.kind];
    if (!(limits.contentTypes as readonly string[]).includes(body.contentType)) {
      throw new ApiError('VALIDATION_FAILED', `Use ${limits.contentTypes.join(', ')}.`, { errors: { contentType: ['Not an allowed image type.'] } });
    }
    if (body.byteSize > limits.maxBytes) throw new ApiError('PAYLOAD_TOO_LARGE', `At most ${limits.maxBytes / 1024 / 1024} MB.`);
    // Staging prefix: never served by the edge, so unvalidated bytes cannot reach visitors.
    const key = `uploads/${tenant.slug}/${randomToken(18)}`;
    const put = await deps.adapters.objectStore.presignPut({ key, contentType: body.contentType, byteSize: body.byteSize, ttlSeconds: UPLOAD_TTL_SECONDS });
    const uploadId = signTicket(deps.config.APP_SECRET, { k: key, kind: body.kind, ct: body.contentType, r: tenant.id, exp: put.expiresAt.getTime() + 300_000 });
    return { uploadId, url: put.url, headers: put.headers, expiresAt: put.expiresAt.toISOString() };
  });

  mount(app, routes.adminCompleteUpload, async ({ c, params }) => {
    const { tenant, deps } = ctx(c);
    const { objectStore } = deps.adapters;
    const ticket = readTicket(deps.config.APP_SECRET, params.uploadId!, tenant.id, deps.now());
    const raw = await objectStore.get(ticket.k);
    if (!raw) throw new ApiError('NOT_FOUND', 'Nothing was uploaded yet.');
    // Validates by content (magic bytes, decode, size) and re-encodes without metadata.
    const files = await processBrandingUpload(ticket.kind, raw, ticket.ct);
    const prefix = `branding/${tenant.slug}/${randomToken(12)}`;
    await Promise.all(files.map(f => objectStore.put(`${prefix}/${f.name}`, f.bytes, f.contentType, 'public, max-age=31536000, immutable')));
    await objectStore.delete(ticket.k).catch(() => undefined);
    const primaryName = ticket.kind === 'LOGO' ? 'logo.webp' : 'favicon.ico';
    return tenantTx(c, async db => {
      await ensureBranding(db, tenant);
      let primaryId: string | null = null;
      for (const f of files) {
        const { rows } = await db.query<{ id: string }>(
          `insert into assets (owner_reseller_id, storage_key, content_type, byte_size, sha256, width, height)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [tenant.id, `${prefix}/${f.name}`, f.contentType, f.bytes.byteLength, f.sha256, f.width, f.height]);
        if (f.name === primaryName) primaryId = rows[0]!.id;
      }
      const col = ticket.kind === 'LOGO' ? 'logo_asset_id' : 'favicon_asset_id';
      await db.query(`update reseller_branding set ${col} = $2, updated_at = now() where reseller_id = $1`, [tenant.id, primaryId]);
      return loadBranding(db, tenant);
    });
  });

  // settings
  mount(app, routes.adminSettings, async ({ c }) => {
    const { rows } = await tenantTx(c, db => db.query<{ d: number }>('select default_share_expiry_days as d from resellers where id = $1', [c.get('tenant')!.id]));
    return { defaultShareExpiryDays: rows[0]!.d };
  });

  mount(app, routes.adminPatchSettings, async ({ c, body }) => {
    const { rows } = await tenantTx(c, db =>
      db.query<{ d: number }>('update resellers set default_share_expiry_days = $2 where id = $1 returning default_share_expiry_days as d', [c.get('tenant')!.id, body.defaultShareExpiryDays]));
    return { defaultShareExpiryDays: rows[0]!.d };
  });

  // saunas, visibility, order, discounts (each write bumps catalog_version by trigger, rule 9)
  mount(app, routes.adminSaunas, async ({ c }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, db => adminSaunas(db, tenant, locale));
  });

  mount(app, routes.adminPatchSauna, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const { rowCount } = await db.query(
        `update reseller_saunas set is_visible = coalesce($3, is_visible), sort_order = coalesce($4, sort_order)
          where reseller_id = $1 and sauna_model_id = $2`,
        [tenant.id, params.id, body.isVisible ?? null, body.sortOrder ?? null]);
      if (!rowCount) throw new ApiError('NOT_FOUND', 'This sauna is not assigned to you.');
      return oneSauna(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminSaunaOrder, async ({ c, body }) => {
    const { tenant, locale } = ctx(c);
    const ids = body.saunaModelIds;
    if (new Set(ids).size !== ids.length) throw new ApiError('VALIDATION_FAILED', 'Each sauna may appear once.');
    return tenantTx(c, async db => {
      const { rowCount } = await db.query(
        `update reseller_saunas rs set sort_order = x.ord::int * 10
           from unnest($2::uuid[]) with ordinality as x(id, ord)
          where rs.reseller_id = $1 and rs.sauna_model_id = x.id`, [tenant.id, ids]);
      if (rowCount !== ids.length) throw new ApiError('VALIDATION_FAILED', 'The list contains saunas that are not assigned to you.');
      return adminSaunas(db, tenant, locale);
    });
  });

  mount(app, routes.adminPutSaunaDiscount, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    checkDiscount(body);
    return tenantTx(c, async db => {
      await oneSauna(db, tenant, locale, params.id!);
      await db.query(
        `insert into reseller_sauna_discounts (reseller_id, sauna_model_id, discount_type, discount_value) values ($1, $2, $3, $4)
         on conflict (reseller_id, sauna_model_id) do update set discount_type = excluded.discount_type, discount_value = excluded.discount_value, updated_at = now()`,
        [tenant.id, params.id, body.type, body.value]);
      return oneSauna(db, tenant, locale, params.id!);
    });
  });

  // per-sauna option availability, price and description (0015)
  mount(app, routes.adminSaunaOptions, async ({ c, params }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, db => saunaOptions(db, tenant, locale, params.id!));
  });

  mount(app, routes.adminPutSaunaOptions, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      // Serialises concurrent edits of one sauna's settings (the row lock is on our own assignment).
      await db.query('select 1 from reseller_saunas where reseller_id = $1 and sauna_model_id = $2 for update', [tenant.id, params.id]);
      checkOptionSettings(await saunaOptions(db, tenant, locale, params.id!), body.options);
      const isDefault = (o: OptionSettingInput) => o.enabled && o.priceOverrideMinor === null && o.descriptionOverride === null;
      const reset = body.options.filter(isDefault).map(o => o.optionId);
      const keep = body.options.filter(o => !isDefault(o));
      if (reset.length) {
        await db.query('delete from reseller_sauna_options where reseller_id = $1 and sauna_model_id = $2 and option_id = any($3::uuid[])', [tenant.id, params.id, reset]);
      }
      if (keep.length) {
        // One statement, so the database's option-rule trigger judges the end state.
        await db.query(
          `insert into reseller_sauna_options (reseller_id, sauna_model_id, option_id, is_enabled, price_override_minor, description_override)
           select $1, $2, x.option_id, x.enabled, x.price, x.description
             from unnest($3::uuid[], $4::boolean[], $5::bigint[], $6::text[]) as x(option_id, enabled, price, description)
           on conflict (reseller_id, sauna_model_id, option_id) do update
             set is_enabled = excluded.is_enabled, price_override_minor = excluded.price_override_minor,
                 description_override = excluded.description_override, updated_at = now()`,
          [tenant.id, params.id, keep.map(o => o.optionId), keep.map(o => o.enabled), keep.map(o => o.priceOverrideMinor), keep.map(o => o.descriptionOverride)]);
      }
      return saunaOptions(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminDeleteSaunaDiscount, async ({ c, params }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      await db.query('delete from reseller_sauna_discounts where reseller_id = $1 and sauna_model_id = $2', [tenant.id, params.id]);
      return oneSauna(db, tenant, locale, params.id!);
    });
  });

  mount(app, routes.adminPutDefaultDiscount, async ({ c, body }) => {
    const { tenant, locale } = ctx(c);
    checkDiscount(body);
    return tenantTx(c, async db => {
      await db.query(
        `insert into reseller_default_discounts (reseller_id, discount_type, discount_value) values ($1, $2, $3)
         on conflict (reseller_id) do update set discount_type = excluded.discount_type, discount_value = excluded.discount_value, updated_at = now()`,
        [tenant.id, body.type, body.value]);
      return adminSaunas(db, tenant, locale);
    });
  });

  mount(app, routes.adminDeleteDefaultDiscount, async ({ c }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      await db.query('delete from reseller_default_discounts where reseller_id = $1', [tenant.id]);
      return adminSaunas(db, tenant, locale);
    });
  });

  // configurations on behalf of customers, and share links
  mount(app, routes.adminConfigurations, async ({ c, query }) => {
    const { tenant, locale, deps } = ctx(c);
    const rows = await tenantTx(c, db => listConfigurationSummaries(db, tenant, locale, decodeCursor(deps.config.APP_SECRET, query.cursor), query.limit));
    const p = pageOf(rows, query.limit, deps.config.APP_SECRET, r => ({ at: r._at, id: r.id }));
    return { items: p.items.map(({ _at, ...r }) => r), nextCursor: p.nextCursor };
  });

  mount(app, routes.adminCreateConfiguration, async ({ c, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const row = await createConfiguration(db, tenant, locale, {
        saunaModelId: body.saunaModelId, name: body.name, selections: body.selections, staffId: me.staffId,
      });
      return toConfigurationDto(db, tenant, locale, row);
    });
  });

  mount(app, routes.adminConfiguration, async ({ c, params }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => toConfigurationDto(db, tenant, locale, await getConfigRow(db, params.id!)));
  });

  mount(app, routes.adminPutSelections, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!);
      await replaceSelections(db, tenant, locale, row, body.optionIds);
      return toConfigurationDto(db, tenant, locale, await getConfigRow(db, row.id));
    });
  });

  mount(app, routes.adminPutPlacement, async ({ c, params, body }) => {
    const { tenant, locale } = ctx(c);
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!);
      await replacePlacement(db, tenant, row, body);
      await db.query('update configurations set updated_at = now() where id = $1', [row.id]);
      return toConfigurationDto(db, tenant, locale, await getConfigRow(db, row.id));
    });
  });

  mount(app, routes.adminShareLinks, async ({ c, params }) => {
    const now = c.get('deps').now();
    const { rows } = await tenantTx(c, async db => {
      await getConfigRow(db, params.id!);
      return db.query<LinkRow>(`${LINK_SQL} where s.configuration_id = $1 order by s.created_at desc`, [params.id]);
    });
    return { items: rows.map(r => linkOf(r, now)) };
  });

  // Sharing locks the configuration and freezes its price (design 9.3); the token is shown once.
  mount(app, routes.adminCreateShareLink, async ({ c, params, body, principal }) => {
    const me = asStaff(principal);
    const { tenant, locale, deps } = ctx(c);
    let token = '';
    const link = await tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!);
      await lockConfiguration(db, tenant, locale, row, deps.config.SHARE_PRICE_VALID_DAYS);
      const { rows: s } = await db.query<{ d: number }>('select default_share_expiry_days as d from resellers where id = $1', [tenant.id]);
      const days = body.expiresInDays ?? s[0]!.d;
      // A short token can collide with an existing one: retry with a new token (a savepoint keeps the transaction usable).
      for (let attempt = 0; attempt < 5; attempt++) {
        token = newShareToken();
        await db.query('savepoint share_insert');
        try {
          const { rows } = await db.query<{ id: string; expires_at: Date }>(
            `insert into share_links (reseller_id, configuration_id, token_hash, created_by_staff_id, expires_at)
             values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id, expires_at`,
            [tenant.id, row.id, hashShareToken(token), me.staffId, days]);
          await db.query('release savepoint share_insert');
          return rows[0]!;
        } catch (err) {
          if ((err as { code?: string }).code !== '23505') throw err;
          await db.query('rollback to savepoint share_insert');
        }
      }
      throw new ApiError('INTERNAL', 'Could not create a share link. Try again.');
    });
    c.header('Cache-Control', 'no-store');
    return { id: link.id, url: `${originFor(deps.config, c.get('host').name)}/s/${token}`, expiresAt: link.expires_at.toISOString() };
  });

  mount(app, routes.adminRevokeShareLink, async ({ c, params }) => {
    const now = c.get('deps').now();
    const row = await tenantTx(c, async db => {
      await db.query('update share_links set revoked_at = now() where id = $1 and configuration_id = $2 and revoked_at is null', [params.linkId, params.id]);
      const { rows } = await db.query<LinkRow>(`${LINK_SQL} where s.id = $1 and s.configuration_id = $2`, [params.linkId, params.id]);
      if (!rows[0]) throw new ApiError('NOT_FOUND', 'Share link not found.');
      const { rows: h } = await db.query<{ token_hash: Buffer }>('select token_hash from share_links where id = $1', [params.linkId]);
      return { link: rows[0], tokenHash: h[0]!.token_hash };
    });
    // After the commit, so a concurrent reader cannot re-cache the pre-revoke state.
    await shareCacheOf(c.get('deps')).delete(shareCacheKeyOfHash(row.tokenHash, c.get('tenant')!.id));
    return linkOf(row.link, now);
  });

}
