import type { Hono } from 'hono';
import { routes, type StorefrontLayout, type Tenant } from '@saunaklar/shared';
import type { AppEnv, Ctx } from '../context.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { assetUrl, listCatalog, listRooms, loadModel } from '../domain/catalog.ts';
import { getConfigRow, getSelections, getSnapshot } from '../domain/configurations.ts';
import { deviceClass, isAutomatedClient, resolveShareToken, visitorPrefix } from '../domain/sharing.ts';
import { issueAssetCookies } from './assets.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';
/**
 * Localised by Accept-Language only: CloudFront's cache key has the query string but not
 * that header, so such a response may be cached by the browser (which honours Vary) but
 * never by a shared cache, or one visitor's language would be served to everybody.
 */
const IMMUTABLE_PRIVATE = 'private, max-age=31536000, immutable';

/**
 * Catalog cache contract (rule 9, review C1). The client asks with
 * `?v=<catalogVersion>` taken from /api/tenant:
 * - exact match: cacheable forever, the URL changes when the catalog does;
 * - mismatch: 409 with the current version, never a stale body cached under a new URL;
 * - no version: served, but not cached anywhere.
 * The tenant cache can be up to 60 s old, so a mismatch is re-checked
 * against the database before it is reported.
 */
async function checkVersion(c: Ctx, v: number | undefined): Promise<void> {
  c.header('Vary', 'Accept-Language');
  if (v === undefined) {
    c.header('Cache-Control', 'no-store');
    return;
  }
  const tenant = c.get('tenant')!;
  let current = tenant.catalogVersion;
  if (v !== current) {
    const { rows } = await c.get('deps').pool.query<{ catalog_version: string }>('select catalog_version from resolve_tenant($1)', [tenant.slug]);
    current = Number(rows[0]?.catalog_version ?? current);
  }
  if (v !== current) {
    c.header('Cache-Control', 'no-store');
    throw new ApiError('STALE_CATALOG_VERSION', 'The catalog has changed, reload it.', { meta: { currentVersion: current } });
  }
  c.header('Cache-Control', c.req.query('lang') ? IMMUTABLE : IMMUTABLE_PRIVATE);
}

const VIEW_DEDUPE_MINUTES = 30;

export function registerCatalog(app: Hono<AppEnv>): void {
  mount(app, routes.tenant, async ({ c, tenant }) => {
    const t = tenant!;
    const body = await tenantTx(c, async db => {
      const { rows } = await db.query<{
        name: string; default_share_expiry_days: number; display_name: string | null; tagline: string | null; primary_color: string | null;
        logo: string | null; favicon: string | null; support_email: string | null; support_phone: string | null;
        legal_name: string | null; legal_address: string | null; vat_display: 'INCLUDED' | 'EXCLUDED' | 'NONE' | null;
        storefront_layout: StorefrontLayout | null;
      }>(
        `select r.name, r.default_share_expiry_days, b.display_name, b.tagline, b.primary_color,
                l.storage_key as logo, f.storage_key as favicon, b.support_email, b.support_phone,
                b.legal_name, b.legal_address, b.vat_display, b.storefront_layout
           from resellers r
           left join reseller_branding b on b.reseller_id = r.id
           left join assets l on l.id = b.logo_asset_id
           left join assets f on f.id = b.favicon_asset_id
          where r.id = $1`, [t.id]);
      const r = rows[0];
      if (!r) throw new ApiError('TENANT_NOT_FOUND');
      const out: Tenant = {
        id: t.id,
        slug: t.slug,
        name: r.name,
        currency: t.currency.trim(),
        catalogVersion: t.catalogVersion,
        defaultShareExpiryDays: r.default_share_expiry_days,
        branding: {
          displayName: r.display_name ?? r.name,
          tagline: r.tagline,
          primaryColor: r.primary_color?.trim() ?? '#5a6b7b',
          logoUrl: assetUrl(r.logo),
          faviconUrl: assetUrl(r.favicon),
          supportEmail: r.support_email,
          supportPhone: r.support_phone,
          legalName: r.legal_name,
          legalAddress: r.legal_address,
          vatDisplay: r.vat_display ?? 'INCLUDED',
          storefrontLayout: r.storefront_layout ?? 'atelier',
        },
      };
      return out;
    });
    // Short shared cache: branding edits and version bumps show within a minute (design 12.2).
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    return body;
  });

  mount(app, routes.catalog, async ({ c, query, tenant }) => {
    await checkVersion(c, query.v);
    const items = await tenantTx(c, db => listCatalog(db, tenant!, requestLocale(c)));
    return { catalogVersion: tenant!.catalogVersion, currency: tenant!.currency.trim(), items };
  });

  mount(app, routes.sauna, async ({ c, query, params, tenant }) => {
    await checkVersion(c, query.v);
    const model = await tenantTx(c, db => loadModel(db, tenant!, requestLocale(c), { slug: params.slug! }));
    if (!model) {
      c.header('Cache-Control', 'no-store');
      throw new ApiError('NOT_FOUND', 'This sauna is not offered here.');
    }
    return model.detail;
  });

  mount(app, routes.rooms, async ({ c, query, tenant }) => {
    await checkVersion(c, query.v);
    const items = await tenantTx(c, db => listRooms(db, tenant!, requestLocale(c)));
    return { items };
  });

  mount(app, routes.shared, async ({ c, params, tenant, principal }) => {
    const now = c.get('deps').now();
    const body = await tenantTx(c, async db => {
      const link = await resolveShareToken(db, params.token!, now);
      const row = await getConfigRow(db, link.configuration_id);
      // Links are only ever created for locked configurations; an unlocked one is a data bug, not a viewable state.
      if (!row.locked_at) throw new ApiError('NOT_FOUND', 'This link does not exist.');
      const [model, selections, snapshot, placement] = await Promise.all([
        loadModel(db, tenant!, requestLocale(c), { id: row.sauna_model_id }, true),
        getSelections(db, row.id),
        getSnapshot(db, row.id),
        db.query<{ room_scene_id: string; position_x_mm: number; position_z_mm: number; rotation_deg: string }>(
          'select room_scene_id, position_x_mm, position_z_mm, rotation_deg from configuration_room_placements where configuration_id = $1', [row.id]),
      ]);
      if (!model || !snapshot) throw new ApiError('NOT_FOUND', 'This link does not exist.');
      // The shop's own staff looking at a link do not count as the customer opening it.
      // Link-preview bots (chat apps, mail scanners, crawlers) are not the customer, and the same
      // visitor reloading within VIEW_DEDUPE_MINUTES is one open, not several.
      const ua = c.req.header('user-agent');
      if (principal.kind !== 'staff' && !isAutomatedClient(ua)) {
        const ip = visitorPrefix({ cloudfront: c.req.header('cloudfront-viewer-address'), forwardedFor: c.req.header('x-forwarded-for') });
        const agent = ua?.slice(0, 200) ?? null;
        await db.query(
          `insert into share_link_views (share_link_id, reseller_id, device_class, ip_prefix, user_agent)
           select $1::uuid, $2::uuid, $3::text, $4::text, $5::text
            where not exists (select 1 from share_link_views v
                               where v.share_link_id = $1::uuid and v.ip_prefix is not distinct from $4::text and v.user_agent is not distinct from $5::text
                                 and v.viewed_at > $6::timestamptz - make_interval(mins => $7::int))`,
          [link.id, tenant!.id, deviceClass(ua), ip, agent, now, VIEW_DEDUPE_MINUTES]);
      }
      const { maxDiscountBps: _cap, ...sauna } = model.detail;
      const p = placement.rows[0];
      return {
        configuration: { id: row.id, name: row.name ?? model.detail.name, selections, lockedAt: row.locked_at.toISOString() },
        sauna,
        placement: p ? { roomSceneId: p.room_scene_id, positionXMm: p.position_x_mm, positionZMm: p.position_z_mm, rotationDeg: Number(p.rotation_deg) } : null,
        snapshot,
        expiresAt: link.expires_at.toISOString(),
      };
    });
    // A share link opens the full-quality model for its holder (design 10.2).
    await issueAssetCookies(c, 'FULL');
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    return body;
  });

  // Time on the page and the inside view, sent by the share page while it is open. Best effort:
  // staff opens and unknown or expired links are ignored without an error, and a link keeps at
  // most 500 visits so a client cannot grow the table.
  mount(app, routes.sharedActivity, async ({ c, params, body, tenant, principal }) => {
    if (principal.kind !== 'staff') {
      const now = c.get('deps').now();
      await tenantTx(c, async db => {
        const link = await resolveShareToken(db, params.token!, now);
        const { rows } = await db.query<{ n: string; has: boolean }>(
          'select count(*) as n, bool_or(visit_id = $2) as has from share_link_activity where share_link_id = $1', [link.id, body.visitId]);
        if (!rows[0]!.has && Number(rows[0]!.n) >= 500) return;
        await db.query(
          `insert into share_link_activity (share_link_id, reseller_id, visit_id, inside_view, seconds) values ($1, $2, $3, $4, $5)
           on conflict (share_link_id, visit_id) do update
             set inside_view = share_link_activity.inside_view or excluded.inside_view,
                 seconds = greatest(share_link_activity.seconds, excluded.seconds), updated_at = now()`,
          [link.id, tenant!.id, body.visitId, body.insideView, body.seconds]);
      });
    }
    c.header('Cache-Control', 'no-store');
    return { ok: true as const };
  });
}
