#!/usr/bin/env node
/**
 * Small database tasks for the production deploy (run from the repo root, DATABASE_URL = owner).
 *   ensure-api-password   sets the sauna_api login password to API_DB_PASSWORD
 *   needs-seed            exit 0 when the database has no shop and no IdP users yet, else 1
 *   lock-demo-users <email>...
 *                         gives every local IdP user a random unusable password, except the
 *                         listed e-mails: those get a new random password, printed once.
 *   rename-user <old> <new>
 *                         gives an existing user (staff row and IdP sign-in) a new e-mail; does nothing
 *                         when <old> does not exist or <new> already does.
 *   ensure-contact <slug> <email> <phone> <tagline>
 *                         replaces placeholder contact details of a shop (an address ending in .test, or empty)
 *                         with the real ones; details David already entered are kept.
 *   set-password <email>  sets the password of one user (read from NEW_PASSWORD)
 *   keep-only-shop <slug> <email>...
 *                         removes every other shop (and its staff, customers, quotes, links),
 *                         the manufacturer admins and all sign-ins except the listed e-mails,
 *                         so the David edition holds only David's shop. DRY_RUN=1 rolls back.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../packages/db/src/password.ts';

const [cmd, ...rest] = process.argv.slice(2);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const strong = () => randomBytes(18).toString('base64url') + '!9';

try {
  if (cmd === 'ensure-api-password') {
    const pw = process.env.API_DB_PASSWORD;
    if (!pw || !/^[0-9a-f]+$/.test(pw)) throw new Error('API_DB_PASSWORD must be a hex string');
    await client.query(`ALTER ROLE sauna_api PASSWORD '${pw}'`);
    console.log('sauna_api password set');
  } else if (cmd === 'needs-seed') {
    const { rows } = await client.query(
      `SELECT (SELECT count(*) FROM resellers)::int AS resellers,
              CASE WHEN to_regclass('idp.users') IS NULL THEN 0 ELSE (SELECT count(*) FROM idp.users)::int END AS users`,
    );
    process.exitCode = rows[0].resellers === 0 || rows[0].users === 0 ? 0 : 1;
  } else if (cmd === 'lock-demo-users') {
    const keep = new Set(rest.map((e) => e.toLowerCase()));
    if (keep.size === 0) throw new Error('give at least one e-mail to keep');
    const { rows } = await client.query('SELECT sub, lower(email) AS email FROM idp.users');
    const issued = [];
    for (const u of rows) {
      const wanted = keep.has(u.email);
      const pw = wanted ? strong() : randomBytes(32).toString('base64url');
      await client.query('UPDATE idp.users SET password_hash = $1 WHERE sub = $2', [await hashPassword(pw), u.sub]);
      if (wanted) issued.push([u.email, pw]);
    }
    console.log('\nNew logins (shown once, not stored anywhere; change them after the first sign-in):');
    for (const [email, pw] of issued) console.log(`  ${email}   ${pw}`);
    console.log(`Other demo users (${rows.length - issued.length}) now have unusable passwords.\n`);
  } else if (cmd === 'keep-only-shop') {
    const [slug, ...emails] = rest;
    if (!slug || emails.length === 0) throw new Error('usage: db-tasks.mjs keep-only-shop <slug> <email>...');
    const keep = emails.map((e) => e.toLowerCase());
    await client.query('BEGIN');
    try {
      // Foreign keys are switched off for this one transaction: every table that carries a
      // reseller_id loses all rows of the other shops, so nothing is left pointing at them.
      await client.query('SET LOCAL session_replication_role = replica');
      const shop = await client.query('SELECT id FROM resellers WHERE slug = $1', [slug]);
      if (!shop.rows[0]) throw new Error(`no shop "${slug}"`);
      const id = shop.rows[0].id;
      const { rows: tables } = await client.query(
        `SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema = 'public' AND c.column_name = 'reseller_id' ORDER BY 1`);
      const removed = {};
      for (const { table_name: tn } of tables) {
        const r = await client.query(`DELETE FROM "${tn}" WHERE reseller_id <> $1`, [id]);
        if (r.rowCount) removed[tn] = r.rowCount;
      }
      removed.resellers = (await client.query('DELETE FROM resellers WHERE id <> $1', [id])).rowCount;
      if ((await client.query("SELECT to_regclass('public.manufacturer_admins') AS t")).rows[0].t) {
        removed.manufacturer_admins = (await client.query('DELETE FROM manufacturer_admins')).rowCount;
      }
      removed.staff_users = (await client.query('DELETE FROM staff_users WHERE lower(email) <> ALL($1::text[])', [keep])).rowCount;
      if ((await client.query("SELECT to_regclass('idp.users') AS t")).rows[0].t) {
        removed.idp_users = (await client.query('DELETE FROM idp.users WHERE lower(email) <> ALL($1::text[])', [keep])).rowCount;
      }
      // Child rows without a reseller_id of their own (selections, price snapshots, ...) follow
      // their parents: delete what points at a removed row (or clear the link for SET NULL keys),
      // repeat until nothing is left dangling.
      const { rows: fks } = await client.query(
        `SELECT c.conname, c.confdeltype AS del, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
                (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS ccols,
                (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS pcols
           FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
      for (let pass = 0; pass < 20; pass++) {
        let changed = 0;
        for (const fk of fks) {
          const on = fk.ccols.map((cc, i) => `p."${fk.pcols[i]}" = c."${cc}"`).join(' AND ');
          const nn = fk.ccols.map((cc) => `c."${cc}" IS NOT NULL`).join(' AND ');
          const dangling = `${nn} AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${on})`;
          const r = fk.del === 'n'
            ? await client.query(`UPDATE ${fk.child} c SET ${fk.ccols.map((cc) => `"${cc}" = NULL`).join(', ')} WHERE ${dangling}`)
            : await client.query(`DELETE FROM ${fk.child} c WHERE ${dangling}`);
          if (r.rowCount) { removed[fk.child] = (removed[fk.child] ?? 0) + r.rowCount; changed += r.rowCount; }
        }
        if (changed === 0) break;
        if (pass === 19) throw new Error('could not settle the references');
      }
      console.log('removed:', JSON.stringify(removed));
      await client.query(process.env.DRY_RUN === '1' ? 'ROLLBACK' : 'COMMIT');
      console.log(process.env.DRY_RUN === '1' ? 'dry run: rolled back' : `only the shop "${slug}" is left`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } else if (cmd === 'rename-user') {
    const [from, to] = rest.map((e) => e?.toLowerCase());
    if (!from || !to) throw new Error('usage: db-tasks.mjs rename-user <old e-mail> <new e-mail>');
    const exists = async (e) => (await client.query('SELECT 1 FROM staff_users WHERE lower(email) = $1', [e])).rowCount;
    if (!(await exists(from)) || (await exists(to))) {
      console.log('rename-user: nothing to do');
    } else {
      await client.query('BEGIN');
      await client.query('UPDATE staff_users SET email = $2 WHERE lower(email) = $1', [from, to]);
      await client.query('UPDATE idp.users SET email = $2, username = $2 WHERE lower(email) = $1', [from, to]);
      await client.query('COMMIT');
      console.log(`rename-user: ${from} is now ${to}`);
    }
  } else if (cmd === 'ensure-contact') {
    const [slug, email, phone, tagline] = rest;
    if (!slug || !email || !phone) throw new Error('usage: db-tasks.mjs ensure-contact <slug> <email> <phone> [tagline]');
    const res = await client.query(
      `UPDATE reseller_branding b SET
         support_email = CASE WHEN b.support_email IS NULL OR b.support_email LIKE '%.test' THEN $2 ELSE b.support_email END,
         support_phone = CASE WHEN b.support_phone IS NULL OR b.support_phone LIKE '%000 00 00' THEN $3 ELSE b.support_phone END,
         tagline = CASE WHEN $4::text IS NOT NULL AND (b.tagline IS NULL OR b.tagline = 'Your sauna, configured together') THEN $4 ELSE b.tagline END
       FROM resellers r WHERE r.id = b.reseller_id AND r.slug = $1`, [slug, email, phone, tagline ?? null]);
    console.log(`ensure-contact: ${res.rowCount} shop(s) checked`);
  } else if (cmd === 'set-password') {
    const email = rest[0];
    const pw = process.env.NEW_PASSWORD;
    if (!email || !pw || pw.length < 12) throw new Error('usage: NEW_PASSWORD=<12+ chars> db-tasks.mjs set-password <email>');
    const res = await client.query('UPDATE idp.users SET password_hash = $1 WHERE lower(email) = lower($2)', [await hashPassword(pw), email]);
    console.log(`${res.rowCount} user(s) updated`);
  } else {
    throw new Error('unknown command');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 2;
} finally {
  await client.end();
}
