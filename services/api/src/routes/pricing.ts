import type { Hono } from 'hono';
import { routes, type Pricing } from '@saunaklar/shared';
import type { AppEnv, Ctx, Db } from '../context.ts';
import { platformTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { assetUrl } from '../domain/catalog.ts';

/**
 * Base price and largest discount of the saunas the shop offers, edited by the shop owner.
 * The catalogue price tables are shared (written by the `app_platform` role), so every statement
 * is scoped to saunas this shop offers and to the shop's own currency. A price change bumps
 * catalog_version (rule 9).
 */

async function pricing(db: Db, resellerId: string, currency: string, locale: string): Promise<Pricing> {
  const { rows } = await db.query<{ id: string; slug: string; name: string; thumb: string | null; list: string | null; disc: number | null }>(
    `select m.id, m.slug, coalesce(t.name, m.name) as name,
            (select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id
              where x.sauna_model_id = m.id and x.asset_role = 'MODEL_THUMBNAIL' order by x.position limit 1) as thumb,
            p.list_price_minor as list, p.max_discount_bps as disc
       from reseller_saunas rs
       join sauna_models m on m.id = rs.sauna_model_id
       left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $3
       left join sauna_model_prices p on p.sauna_model_id = m.id and p.currency_code = $2
      where rs.reseller_id = $1
      order by m.sort_order, name`, [resellerId, currency, locale]);
  return {
    currency: currency as Pricing['currency'],
    items: rows.map(r => ({
      id: r.id, slug: r.slug, name: r.name, thumbnailUrl: assetUrl(r.thumb),
      listPriceMinor: r.list === null ? null : Number(r.list), maxDiscountBps: r.disc === null ? null : Number(r.disc),
    })),
  };
}

export function registerPricing(app: Hono<AppEnv>): void {
  const scope = (c: Ctx) => {
    const tenant = c.get('tenant')!;
    return { id: tenant.id, currency: tenant.currency.trim(), locale: requestLocale(c) };
  };

  mount(app, routes.adminPricing, async ({ c }) => {
    const s = scope(c);
    c.header('Cache-Control', 'no-store');
    return platformTx(c, db => pricing(db, s.id, s.currency, s.locale));
  });

  mount(app, routes.adminPutPrice, async ({ c, params, body }) => {
    const s = scope(c);
    return platformTx(c, async db => {
      const offered = await db.query('select 1 from reseller_saunas where reseller_id = $1 and sauna_model_id = $2', [s.id, params.id]);
      if (!offered.rows[0]) throw new ApiError('NOT_FOUND', 'This sauna is not offered here.');
      await db.query(
        `insert into sauna_model_prices (sauna_model_id, currency_code, list_price_minor, max_discount_bps) values ($1, $2, $3, $4)
         on conflict (sauna_model_id, currency_code) do update set list_price_minor = excluded.list_price_minor,
           max_discount_bps = excluded.max_discount_bps, updated_at = now()`,
        [params.id, s.currency, body.listPriceMinor, body.maxDiscountBps]);
      return pricing(db, s.id, s.currency, s.locale);
    });
  });
}
