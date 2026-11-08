#!/usr/bin/env node
/**
 * Small database tasks for the production deploy (run from the repo root, DATABASE_URL = owner).
 *   ensure-api-password   sets the sauna_api login password to API_DB_PASSWORD
 *   needs-seed            exit 0 when the database has no shop and no IdP users yet, else 1
 *   lock-demo-users <email>...
 *                         gives every local IdP user a random unusable password, except the
 *                         listed e-mails: those get a new random password, printed once.
 *   set-password <email>  sets the password of one user (read from NEW_PASSWORD)
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
