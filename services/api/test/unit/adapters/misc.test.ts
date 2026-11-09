import { describe, expect, it } from 'vitest';
import { createAdapters, createLocalEdge, roleTx } from '../../../src/adapters/index.ts';
import { DevMailboxMailer } from '../../../src/adapters/mail/dev-mailbox.ts';
import { LocalObjectStore } from '../../../src/adapters/storage/local.ts';
import type { Queryable } from '../../../src/adapters/types.ts';

describe('createAdapters', () => {
  it('returns exactly the adapters the routes use, lazily', () => {
    const adapters = createAdapters({ ADAPTERS: 'local' }, {});
    expect(Object.keys(adapters).sort()).toEqual(['assetSigner', 'identity', 'mailer', 'objectStore']);
    // Nothing needing a DB pool is built until used.
    expect(adapters.assetSigner).toBeDefined();
    expect(adapters.objectStore).toBeInstanceOf(LocalObjectStore);
    expect(() => adapters.identity).toThrow('database pool');
  });

  it('local secrets have dev defaults but are mandatory in production', () => {
    expect(() => createAdapters({ ADAPTERS: 'local', NODE_ENV: 'production' }).assetSigner).toThrow('LOCAL_ASSET_SIGNING_SECRET');
  });

  it('presigned local uploads verify through the local edge', async () => {
    const env = { ADAPTERS: 'local', LOCAL_OBJECTS_DIR: '/tmp/never-written' };
    const put = await createAdapters(env).objectStore.presignPut({ key: 'uploads/alpha/r1', contentType: 'image/png', byteSize: 10, ttlSeconds: 60 });
    const hit = createLocalEdge(env).verifyUpload(put.url.replace('/dev/uploads/', ''));
    expect(hit?.grant).toMatchObject({ key: 'uploads/alpha/r1', contentType: 'image/png', byteSize: 10 });
    expect(createLocalEdge({ ...env, LOCAL_UPLOAD_SIGNING_SECRET: 'x'.repeat(40) }).verifyUpload(put.url.slice(13))).toBeNull();
  });

  it('asset cookies verify through the local edge', async () => {
    const env = { ADAPTERS: 'local' };
    const { cookies } = await createAdapters(env).assetSigner.issueCookies({ host: 'alpha.localhost:5173', tier: 'FULL', ttlSeconds: 60 });
    const jar = Object.fromEntries(cookies.map((c) => [c.name, c.value]));
    expect(createLocalEdge(env).verifyAssetRequest({ host: 'alpha.localhost:5173', path: '/assets/hi/a.glb', cookies: jar })).toBe(true);
  });
});

describe('roleTx', () => {
  it('wraps work in BEGIN / SET LOCAL ROLE / COMMIT and rolls back on error', async () => {
    const log: string[] = [];
    const client = { query: async (sql: string) => (log.push(sql), { rows: [], rowCount: 0 }), release: () => log.push('release') };
    const tx = roleTx({ connect: async () => client } as never, 'idp_local');
    await tx(async (db) => db.query('SELECT 1'));
    await expect(tx(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(log).toEqual(['BEGIN', 'SET LOCAL ROLE idp_local', 'SELECT 1', 'COMMIT', 'release', 'BEGIN', 'SET LOCAL ROLE idp_local', 'ROLLBACK', 'release']);
    expect(() => roleTx({ connect: async () => client } as never, 'x; DROP')).toThrow();
  });
});

describe('DevMailboxMailer', () => {
  it('stores the mail with its envelope in devtools.mailbox', async () => {
    const calls: [string, readonly unknown[]][] = [];
    const db: Queryable = { query: async (text, values = []) => (calls.push([text, values]), { rows: [{ id: 7 }] as never[], rowCount: 1 }) };
    const mailer = new DevMailboxMailer((fn) => fn(db), 'mail.localhost');
    await expect(mailer.send({ to: 'a@b.ch', subject: 'Hi\nthere', html: '<p/>', text: 'body', fromName: 'Alpha', replyTo: 'r@a.ch', resellerId: 'r1' })).resolves.toEqual({ messageId: '7' });
    expect(calls[0]![0]).toContain('INSERT INTO devtools.mailbox (reseller_id, to_address, subject, html, text)');
    expect(calls[0]![1]).toEqual(['r1', 'a@b.ch', 'Hi there', '<p/>', 'From: "Alpha" <no-reply@mail.localhost>\nReply-To: r@a.ch\n\nbody']);
  });
});
