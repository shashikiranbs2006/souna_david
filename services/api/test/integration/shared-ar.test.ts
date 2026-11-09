import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AR_FILE_MAX_BYTES } from '@saunaklar/shared';
import { SEED, SEED_PASSWORD } from '@saunaklar/db/seed';
import { createHarness, type Client, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

const DAY = 86_400_000;

async function alphaStaff(): Promise<Client> {
  const c = h.client('alpha.localhost');
  await c.staffLogin('owner@alpha.test', SEED_PASSWORD);
  return c;
}

/** A locked configuration with a fresh share link: its id, the link id and the token. */
async function sharedConfiguration(staff: Client, name: string) {
  const cfg = await staff.post('/api/admin/configurations', { saunaModelId: SEED.models('fjord-panorama'), name });
  expect(cfg.status, JSON.stringify(cfg.body)).toBe(201);
  return { configurationId: cfg.body.id as string, ...(await newLink(staff, cfg.body.id)) };
}

async function newLink(staff: Client, configurationId: string) {
  const link = await staff.post(`/api/admin/configurations/${configurationId}/share-links`, { expiresInDays: 7 });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  return { linkId: link.body.id as string, token: /\/s\/([A-Za-z0-9_-]+)$/.exec(link.body.url)![1]! };
}

/** The smallest well-formed GLB: header plus a JSON chunk. */
function glb(): Buffer {
  let json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const out = Buffer.alloc(20 + json.length);
  out.write('glTF', 0, 'latin1');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  return out;
}

/** A zip local-file header, as every USDZ starts with. */
const usdz = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)]);
const files = (g = glb(), u = usdz()) => ({ glb: g.toString('base64'), usdz: u.toString('base64') });
const pathOf = (url: string) => new URL(url).pathname;

describe('shared link: AR files of the configured sauna', () => {
  it('stores the files once under the configuration fingerprint and returns signed URLs', async () => {
    const staff = await alphaStaff();
    const { configurationId, token } = await sharedConfiguration(staff, 'AR showroom');
    const visitor = h.client('alpha.localhost');
    const url = `/api/shared/${token}/ar-files`;

    const probe = await visitor.post(url, {});
    expect(probe.status, JSON.stringify(probe.body)).toBe(200);
    expect(probe.body).toMatchObject({ ready: false, reused: false, glbUrl: null, usdzUrl: null });
    expect(probe.headers.get('cache-control')).toBe('no-store');

    const stored = await visitor.post(url, files());
    expect(stored.status, JSON.stringify(stored.body)).toBe(200);
    expect(stored.body.ready).toBe(true);
    expect(stored.body.reused).toBe(false);
    expect(pathOf(stored.body.glbUrl)).toMatch(/^\/assets\/ar\/[0-9a-f-]{36}\/[0-9a-f]{64}\.glb$/);
    expect(pathOf(stored.body.usdzUrl)).toBe(pathOf(stored.body.glbUrl).replace(/\.glb$/, '.usdz'));
    expect(stored.body.glbUrl).toContain('Signature=');
    const ttl = new Date(stored.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(h.deps.config.AR_URL_TTL_SECONDS * 1000);

    const key = pathOf(stored.body.glbUrl).slice(1);
    const store = h.deps.adapters.objectStore;
    expect((await store.head(key))?.contentType).toBe('model/gltf-binary');
    expect((await store.head(key.replace(/\.glb$/, '.usdz')))?.contentType).toBe('model/vnd.usdz+zip');
    expect((await store.get(key))?.subarray(0, 4).toString('latin1')).toBe('glTF');

    // A second call (another visit, another phone) reuses the files: no export, no upload.
    const again = await h.client('alpha.localhost').post(url, {});
    expect(again.body).toMatchObject({ ready: true, reused: true });
    expect(pathOf(again.body.glbUrl)).toBe(pathOf(stored.body.glbUrl));
    // Sending files again does not replace the stored ones.
    const resend = await visitor.post(url, files());
    expect(resend.body).toMatchObject({ ready: true, reused: true });

    // Another link to the same configuration finds the same files.
    const second = await newLink(staff, configurationId);
    const viaSecond = await visitor.post(`/api/shared/${second.token}/ar-files`, {});
    expect(viaSecond.body).toMatchObject({ ready: true, reused: true });
    expect(pathOf(viaSecond.body.glbUrl)).toBe(pathOf(stored.body.glbUrl));
  });

  it('refuses unknown, revoked and expired links', async () => {
    const staff = await alphaStaff();
    const visitor = h.client('alpha.localhost');
    expect((await visitor.post('/api/shared/not-a-token/ar-files', {})).status).toBe(404);
    expect((await visitor.post(`/api/shared/${'A'.repeat(43)}/ar-files`, files())).status).toBe(404);

    const { configurationId, linkId, token } = await sharedConfiguration(staff, 'AR revoked');
    expect((await visitor.post(`/api/shared/${token}/ar-files`, {})).status).toBe(200);
    // Not on another shop's host.
    expect((await h.client('beta.localhost').post(`/api/shared/${token}/ar-files`, {})).status).toBe(404);

    const real = h.deps.now;
    h.deps.now = () => new Date(Date.now() + 8 * DAY);
    try {
      const expired = await visitor.post(`/api/shared/${token}/ar-files`, files());
      expect(expired.body.code).toBe('SHARE_LINK_EXPIRED');
    } finally {
      h.deps.now = real;
    }

    expect((await staff.del(`/api/admin/configurations/${configurationId}/share-links/${linkId}`)).status).toBe(200);
    const revoked = await visitor.post(`/api/shared/${token}/ar-files`, files());
    expect(revoked.body.code).toBe('SHARE_LINK_REVOKED');
  });

  it('rejects oversize files, wrong file types and a single file', async () => {
    const staff = await alphaStaff();
    const { token } = await sharedConfiguration(staff, 'AR invalid uploads');
    const visitor = h.client('alpha.localhost');
    const url = `/api/shared/${token}/ar-files`;

    const big = Buffer.alloc(AR_FILE_MAX_BYTES + 1);
    glb().copy(big);
    big.writeUInt32LE(big.length, 8);
    const oversize = await visitor.post(url, files(big));
    expect(oversize.status).toBe(413);
    expect(oversize.body.code).toBe('PAYLOAD_TOO_LARGE');

    const notGlb = await visitor.post(url, files(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)])));
    expect(notGlb.status).toBe(422);
    expect(notGlb.body.errors.glb).toBeDefined();
    expect(notGlb.body.errors.usdz).toBeUndefined();

    const notUsdz = await visitor.post(url, files(glb(), Buffer.from('<?xml version="1.0"?><usd></usd>')));
    expect(notUsdz.status).toBe(422);
    expect(notUsdz.body.errors.usdz).toBeDefined();

    const truncated = glb().subarray(0, 24);
    expect((await visitor.post(url, files(truncated))).status).toBe(422);

    expect((await visitor.post(url, { glb: glb().toString('base64') })).status).toBe(422);
    expect((await visitor.post(url, { glb: 'not base64 at all!!!!!!!!!', usdz: usdz().toString('base64') })).status).toBe(422);

    // Nothing was stored by the rejected calls.
    expect((await visitor.post(url, {})).body.ready).toBe(false);
  });
});
