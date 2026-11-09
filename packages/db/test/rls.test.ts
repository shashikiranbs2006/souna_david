import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ALPHA, BETA, GAMMA, M, SEED, as, count, expectCode, one, ownerTx, platform, setupEnv, tenant, type Env } from './helpers.ts';

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.close(); });

const worker = <T>(fn: (c: pg.PoolClient) => Promise<T>) => as(env, 'app_worker', {}, fn);

/** Tables holding tenant rows, with how many rows beta owns in the seed (> 0 for every one). */
const TENANT_TABLES = [
  'configurations', 'configuration_selections',
  'configuration_price_snapshots', 'configuration_price_snapshot_lines', 'reseller_saunas', 'reseller_sauna_discounts', 'reseller_room_scenes',
  'reseller_branding', 'reseller_admins',
];

describe('rule 12: tenant isolation', () => {
  it('fails closed: no tenant set means zero rows everywhere', async () => {
    for (const t of [...TENANT_TABLES, 'resellers', 'sauna_models', 'sauna_model_prices', 'options', 'room_scenes', 'share_links']) {
      expect(await tenant(env, null, c => count(c, `SELECT 1 FROM ${t}`)), t).toBe(0);
    }
  });

  it('a malformed tenant setting also reads as no tenant', async () => {
    const c = await env.api.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE app_tenant');
      await c.query(`SELECT set_config('app.reseller_id', 'x'' OR true --', true)`);
      expect(await count(c, 'SELECT 1 FROM configurations')).toBe(0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('tenant A reads none of tenant B\'s rows (every tenant table)', async () => {
    for (const t of TENANT_TABLES) {
      const betaRows = await count(env.owner, `SELECT 1 FROM ${t} WHERE ${t === 'configuration_selections' || t.startsWith('configuration_price')
        ? `configuration_id IN (SELECT id FROM configurations WHERE reseller_id = '${BETA}')` : `reseller_id = '${BETA}'`}`);
      expect(betaRows, `seed has beta rows in ${t}`).toBeGreaterThan(0);
      const seen = await tenant(env, ALPHA, c => count(c, `SELECT 1 FROM ${t} WHERE ${t === 'configuration_selections' || t.startsWith('configuration_price')
        ? `configuration_id IN (SELECT id FROM configurations WHERE reseller_id = '${BETA}')` : `reseller_id = '${BETA}'`}`));
      expect(seen, t).toBe(0);
    }
    expect(await tenant(env, BETA, c => count(c, 'SELECT 1 FROM share_links'))).toBe(0);
    expect(await tenant(env, ALPHA, c => count(c, 'SELECT 1 FROM share_links'))).toBe(1);
  });

  it('tenant A cannot write tenant B rows', async () => {
    // insert with another reseller_id: RLS WITH CHECK
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO configurations (reseller_id, sauna_model_id) VALUES ($1, $2)`, [BETA, M('espoo-compact')])),
      'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO configuration_selections VALUES ($1, $2, $3)`,
      [SEED.configurations.betaDraft, M('espoo-compact'), SEED.options('door-clear')])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`INSERT INTO share_link_views (share_link_id, reseller_id) VALUES ($1, $2)`,
      [SEED.shareLinkId, BETA])), 'INSUFFICIENT_PRIVILEGE');
    // update / delete of invisible rows touch nothing
    for (const [sql, args] of [
      ['UPDATE configurations SET name = $2 WHERE id = $1', [SEED.configurations.betaDraft, 'x']],
      ['DELETE FROM configuration_selections WHERE configuration_id = $1', [SEED.configurations.betaDraft]],
      ['DELETE FROM reseller_sauna_discounts WHERE reseller_id = $1', [BETA]],
    ] as [string, unknown[]][]) {
      const r = await tenant(env, ALPHA, c => c.query(sql, args), { actorStaffId: SEED.staff.alphaOwner });
      expect(r.rowCount, sql).toBe(0);
    }
    expect((await one<{ n: string }>(env.owner, 'SELECT name AS n FROM configurations WHERE id = $1', [SEED.configurations.betaDraft])).n).toBe('Small one');
  });

  it('shows a tenant only the catalog it offers, priced in its own currency', async () => {
    const alpha = await tenant(env, ALPHA, async c => ({
      models: (await c.query<{ slug: string }>('SELECT slug FROM sauna_models ORDER BY slug')).rows.map(r => r.slug),
      currencies: (await c.query<{ c: string }>('SELECT DISTINCT currency_code AS c FROM sauna_model_prices')).rows.map(r => r.c),
      optionCurrencies: (await c.query<{ c: string }>('SELECT DISTINCT currency_code AS c FROM sauna_model_option_prices')).rows.map(r => r.c),
      rooms: await count(c, 'SELECT 1 FROM room_scenes'),
    }));
    expect(alpha.models).toEqual(['aurora-hex', 'espoo-compact', 'fjord-panorama', 'kelo-barrel', 'kide-glass-corner', 'lappi-corner']);
    expect(alpha.currencies).toEqual(['EUR']);
    expect(alpha.optionCurrencies).toEqual(['EUR']);
    expect(alpha.rooms).toBe(3);
    const gamma = await tenant(env, GAMMA, async c => ({
      currencies: (await c.query<{ c: string }>('SELECT DISTINCT currency_code AS c FROM sauna_model_prices')).rows.map(r => r.c),
      helsinki: await count(c, 'SELECT 1 FROM sauna_model_option_groups WHERE sauna_model_id = $1', [M('saimaa-garden-house')]),
      rooms: await count(c, 'SELECT 1 FROM room_scenes'),
      espooAssets: await count(c, `SELECT 1 FROM assets WHERE storage_key LIKE '%/espoo-compact/%'`),
      assets: await count(c, 'SELECT 1 FROM assets'),
    }));
    // Gamma offers kelo-barrel, lappi-corner and aurora-hex (6 assets each), the basement-spa room
    // (1 thumbnail) and the 46 options those models carry (1 thumbnail each); nothing of Espoo.
    expect(gamma).toEqual({ currencies: ['SEK'], helsinki: 0, rooms: 1, espooAssets: 0, assets: 3 * 6 + 1 + 46 });
    // Beta offers espoo-compact: its 4 sample files plus 2 gallery images.
    expect(await tenant(env, BETA, c => count(c, `SELECT 1 FROM assets WHERE storage_key LIKE '%/espoo-compact/%'`))).toBe(6);
  });

  it('lets a tenant change its own visibility, order, share expiry and branding only', async () => {
    await tenant(env, ALPHA, async c => {
      await c.query(`UPDATE reseller_saunas SET sort_order = 5 WHERE sauna_model_id = $1`, [M('aurora-hex')]);
      await c.query(`UPDATE resellers SET default_share_expiry_days = 14 WHERE id = $1`, [ALPHA]);
      await c.query(`UPDATE reseller_branding SET primary_color = '#203040' WHERE reseller_id = $1`, [ALPHA]);
    });
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE resellers SET name = 'x'`)), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_branding SET primary_color = '#FFFFFF'`)), 'CHECK_VIOLATION');
  });

  it('exposes staff names but not e-mails to tenants', async () => {
    const names = await tenant(env, ALPHA, c => c.query<{ display_name: string }>('SELECT id, display_name FROM staff_users'));
    expect(names.rows.map(r => r.display_name)).toEqual(['Anton Albrecht', 'Alma Arnold']);
    await expectCode(tenant(env, ALPHA, c => c.query('SELECT email FROM staff_users')), 'INSUFFICIENT_PRIVILEGE');
  });
});

describe('platform, worker and catalog roles', () => {
  it('app_platform cannot read configurations or share links', async () => {
    for (const t of ['configurations', 'share_links']) {
      await expectCode(platform(env, c => c.query(`SELECT * FROM ${t} LIMIT 1`)), 'INSUFFICIENT_PRIVILEGE');
    }
  });

  it('app_platform manages resellers, assignments and prices', async () => {
    await platform(env, async c => {
      await c.query(`UPDATE sauna_model_prices SET list_price_minor = 700000 WHERE sauna_model_id = $1 AND currency_code = 'EUR'`, [M('espoo-compact')]);
      await c.query(`UPDATE reseller_saunas SET is_visible = true WHERE reseller_id = $1`, [ALPHA]);
      await c.query(`UPDATE resellers SET name = 'Gamma Bastu' WHERE id = $1`, [GAMMA]);
    });
    await expectCode(platform(env, c => c.query(`UPDATE reseller_sauna_discounts SET discount_value = 0`)), 'INSUFFICIENT_PRIVILEGE');
  });

});

describe('storefront layout and manufacturer', () => {
  const layout = (r: string) => (c: pg.PoolClient) => one<{ l: string }>(c, 'SELECT storefront_layout AS l FROM reseller_branding WHERE reseller_id = $1', [r]).then(x => x.l);

  it('seeds distinct layouts; a tenant changes only its own; the CHECK allows the five layouts only', async () => {
    expect(await tenant(env, ALPHA, layout(ALPHA))).toBe('atelier');
    expect(await tenant(env, BETA, layout(BETA))).toBe('showroom');
    expect(await one(env.owner, 'SELECT storefront_layout AS l FROM reseller_branding WHERE reseller_id = $1', [GAMMA])).toEqual({ l: 'nordic' });
    await tenant(env, ALPHA, async c => {
      await c.query(`UPDATE reseller_branding SET storefront_layout = 'catalogue' WHERE reseller_id = $1`, [ALPHA]);
      expect(await layout(ALPHA)(c)).toBe('catalogue');
      // Beta's row is invisible to alpha: the update matches nothing.
      expect((await c.query(`UPDATE reseller_branding SET storefront_layout = 'journal' WHERE reseller_id = $1`, [BETA])).rowCount).toBe(0);
      await c.query(`UPDATE reseller_branding SET storefront_layout = 'atelier' WHERE reseller_id = $1`, [ALPHA]);
    });
    expect(await tenant(env, BETA, layout(BETA))).toBe('showroom');
    await expectCode(tenant(env, ALPHA, c => c.query(`UPDATE reseller_branding SET storefront_layout = 'brutalist' WHERE reseller_id = $1`, [ALPHA])),
      'CHECK_VIOLATION');
    const col = await one(env.owner, `SELECT column_default AS d, is_nullable AS n FROM information_schema.columns
                                       WHERE table_name = 'reseller_branding' AND column_name = 'storefront_layout'`);
    expect(col).toEqual({ d: "'atelier'::text", n: 'NO' });
  });

  it('a tenant reads its manufacturer name through its reseller', async () => {
    const m = await tenant(env, ALPHA, c => one(c, 'SELECT m.name FROM resellers r JOIN manufacturers m ON m.id = r.manufacturer_id'));
    expect(m).toEqual({ name: 'Nordlicht Saunabau' });
  });
});

describe('SECURITY DEFINER API functions', () => {
  const alphaSub = () => one<{ s: string }>(env.owner, 'SELECT idp_subject AS s FROM staff_users WHERE id = $1', [SEED.staff.alphaOwner]).then(r => r.s);

  it('staff_principal_for_reseller returns ACTIVE admins of that reseller only', async () => {
    const sub = await alphaSub();
    const p = await tenant(env, ALPHA, c => c.query('SELECT * FROM staff_principal_for_reseller($1, $2)', [sub, ALPHA]));
    expect(p.rows).toEqual([{ staff_user_id: SEED.staff.alphaOwner, email: 'owner@alpha.test', display_name: 'Anton Albrecht', role: 'OWNER', status: 'ACTIVE' }]);
    expect((await tenant(env, BETA, c => c.query('SELECT * FROM staff_principal_for_reseller($1, $2)', [sub, BETA]))).rowCount).toBe(0);
    await expectCode(platform(env, c => c.query('SELECT * FROM staff_principal_for_reseller($1, $2)', [sub, ALPHA])), 'INSUFFICIENT_PRIVILEGE');
  });

  it('staff_by_email and activate_staff_user', async () => {
    const byEmail = await tenant(env, ALPHA, c => one(c, `SELECT * FROM staff_by_email('OWNER@alpha.test ')`));
    expect(byEmail).toMatchObject({ staff_user_id: SEED.staff.alphaOwner, status: 'ACTIVE' });

    await ownerTx(env, c => c.query(`INSERT INTO staff_users (email, display_name, idp_subject, status) VALUES ('new@alpha.test', 'New', 'sub-new', 'INVITED')`));
    expect((await platform(env, c => one<{ a: boolean }>(c, `SELECT activate_staff_user('sub-new') AS a`))).a).toBe(true);
    expect((await platform(env, c => one<{ a: boolean }>(c, `SELECT activate_staff_user('sub-new') AS a`))).a).toBe(false);
    await ownerTx(env, c => c.query(`UPDATE staff_users SET status = 'DISABLED' WHERE idp_subject = 'sub-new'`));
    expect((await tenant(env, ALPHA, c => one<{ a: boolean }>(c, `SELECT activate_staff_user('sub-new') AS a`))).a).toBe(false);
  });

});

describe('worker retention functions', () => {
  it('retention_delete_batch respects the limit and the allow-list', async () => {
    await ownerTx(env, c => c.query(`INSERT INTO share_link_views (share_link_id, reseller_id, viewed_at)
      SELECT $1, $2, now() - interval '2 years' - n * interval '1 minute' FROM generate_series(1, 5) n`, [SEED.shareLinkId, ALPHA]));
    const cutoff = `now() - interval '13 months'`;
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('share_link_views', ${cutoff}, 3) AS n`))).n).toBe(3);
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('share_link_views', ${cutoff}, 3) AS n`))).n).toBe(2);
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('share_link_views', ${cutoff}, 3) AS n`))).n).toBe(0);
    expect(await count(env.owner, 'SELECT 1 FROM share_link_views')).toBeGreaterThanOrEqual(2); // recent views untouched
    expect((await worker(c => one<{ n: number }>(c, `SELECT retention_delete_batch('audit_events', ${cutoff}, 10) AS n`))).n).toBe(0);
    await expectCode(worker(c => c.query(`SELECT retention_delete_batch('configurations', now(), 10)`)), 'RETENTION_TABLE_NOT_ALLOWED');
    await expectCode(tenant(env, ALPHA, c => c.query(`SELECT retention_delete_batch('audit_events', now(), 10)`)), 'INSUFFICIENT_PRIVILEGE');
  });

  it('run_retention() returns deleted counts', async () => {
    const r = await worker(c => one<{ r: Record<string, number> }>(c, 'SELECT run_retention() AS r'));
    expect(Object.keys(r.r).sort()).toEqual(['auditEvents', 'shareLinkViews']);
  });
});
