import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, SEED, type TestDatabase } from '@saunaklar/db/seed';
import { silentLogger } from '../../src/lib/log.ts';
import { runRetention } from '../../src/worker/retention.ts';

let db: TestDatabase;
let owner: pg.Pool;
let api: pg.Pool;
beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  owner = new pg.Pool({ connectionString: db.url, max: 4 });
  api = new pg.Pool({ connectionString: db.apiUrl, max: 8 });
});
afterAll(async () => {
  await Promise.all([owner?.end(), api?.end()]);
  await db?.drop();
});

const DAY = 86_400_000;
const count = async (sql: string) => Number((await owner.query<{ n: string }>(sql)).rows[0]!.n);

describe('runRetention', () => {
  it('deletes only expired rows, in batches, through the app_worker role', async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const alpha = SEED.resellers.alpha;
    const { rows: [link] } = await owner.query<{ id: string }>(
      `INSERT INTO share_links (reseller_id, configuration_id, token_hash, created_by_staff_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '30 days') RETURNING id`,
      [alpha, SEED.configurations.staffShared, randomBytes(32), SEED.staff.alphaOwner],
    );
    await owner.query('DELETE FROM share_link_views');
    // share_link_views: 13 months
    await owner.query(
      `INSERT INTO share_link_views (share_link_id, reseller_id, viewed_at) SELECT $1, $2, ts FROM unnest($3::timestamptz[]) ts`,
      [link!.id, alpha, [ago(400), ago(400), ago(400), ago(420), ago(300), ago(1)]],
    );
    // audit: 24 months
    await owner.query('DELETE FROM audit_events');
    await owner.query(
      `INSERT INTO audit_events (occurred_at, action, entity_type, entity_id)
       VALUES ($1, 'x.update', 'x', '1'), ($2, 'x.update', 'x', '2'), ($3, 'x.update', 'x', '3')`,
      [ago(800), ago(740), ago(700)],
    );

    const result = await runRetention({ pool: api, log: silentLogger, now: () => now, batchSize: 2 });
    expect(result).toEqual({ shareLinkViews: 4, shareLinkActivity: 0, auditEvents: 2, failedJobs: [] });
    expect(await count('SELECT count(*) AS n FROM share_link_views')).toBe(2);
    expect(await count(`SELECT count(*) AS n FROM audit_events WHERE entity_type = 'x'`)).toBe(1);

    // A second run finds nothing.
    expect(await runRetention({ pool: api, log: silentLogger, now: () => now })).toEqual({ shareLinkViews: 0, shareLinkActivity: 0, auditEvents: 0, failedJobs: [] });
  });
});
