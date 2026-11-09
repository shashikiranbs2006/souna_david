import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { AR_FILE_MAX_BYTES, routes } from '@saunaklar/shared';
import type { AppEnv } from '../context.ts';
import { tenantTx } from '../lib/db.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { getConfigRow, getSelections } from '../domain/configurations.ts';
import { sceneViewerSafeGlb } from '../domain/sceneViewerGlb.ts';
import { resolveShareLink } from '../domain/sharing.ts';

/**
 * "View in your room" for a share link (the exact configured sauna, not the
 * model's stock AR file). The share page exports the configured sauna in the
 * browser and hands the GLB (Android Scene Viewer) and USDZ (iPhone Quick Look)
 * to this route once. They are stored under a fingerprint of the configuration
 * (as in the owner's earlier studio: identical designs are stored once) and
 * returned as short-lived signed URLs: the phone's AR viewer needs a real
 * HTTPS file, not a blob: URL.
 *
 * A call without files only asks whether the files exist, so a second visit
 * (or a second phone) skips the export entirely.
 */

/**
 * Export format version. Part of the fingerprint, so a change to the exporter
 * never serves a file made by an older one.
 */
export const AR_EXPORT_FORMAT = 'kit-ar-v1';

const GLB = { contentType: 'model/gltf-binary', ext: 'glb' } as const;
const USDZ = { contentType: 'model/vnd.usdz+zip', ext: 'usdz' } as const;

/** Same configuration and selections -> same files. Selection order does not matter. */
export function arFingerprint(configurationId: string, selections: readonly string[]): string {
  return createHash('sha256').update(`${AR_EXPORT_FORMAT}|${configurationId}|${[...selections].sort().join(',')}`).digest('hex');
}

/** A binary glTF 2.0 whose header length matches the file. */
function isGlb(b: Buffer): boolean {
  return b.length >= 20 && b.toString('latin1', 0, 4) === 'glTF' && b.readUInt32LE(4) === 2 && b.readUInt32LE(8) === b.length;
}

/** USDZ is an uncompressed zip: it starts with a local file header. */
function isUsdz(b: Buffer): boolean {
  return b.length >= 30 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

export function registerSharedAr(app: Hono<AppEnv>): void {
  mount(app, routes.sharedArFiles, async ({ c, params, body, tenant }) => {
    const { adapters, config, now } = c.get('deps');
    const store = adapters.objectStore;
    const fingerprint = await tenantTx(c, async db => {
      const link = await resolveShareLink(c, db, params.token!);
      const row = await getConfigRow(db, link.configuration_id);
      // Links are only created for locked configurations; anything else is not viewable.
      if (!row.locked_at) throw new ApiError('NOT_FOUND', 'This link does not exist.');
      return arFingerprint(row.id, await getSelections(db, row.id));
    });
    const keys = {
      glb: `assets/ar/${tenant!.id}/${fingerprint}.${GLB.ext}`,
      usdz: `assets/ar/${tenant!.id}/${fingerprint}.${USDZ.ext}`,
    };
    const [glbHead, usdzHead] = await Promise.all([store.head(keys.glb), store.head(keys.usdz)]);
    const stored = Boolean(glbHead && usdzHead);
    c.header('Cache-Control', 'no-store');

    if (!stored) {
      if (body.glb === undefined || body.usdz === undefined) return { ready: false, reused: false, glbUrl: null, usdzUrl: null, expiresAt: null };
      const glb = Buffer.from(body.glb, 'base64');
      const usdz = Buffer.from(body.usdz, 'base64');
      if (glb.length > AR_FILE_MAX_BYTES || usdz.length > AR_FILE_MAX_BYTES) {
        throw new ApiError('PAYLOAD_TOO_LARGE', `Each AR file may be at most ${AR_FILE_MAX_BYTES / 1024 / 1024} MB.`);
      }
      const errors: Record<string, string[]> = {};
      if (!isGlb(glb)) errors.glb = ['Not a binary glTF (GLB) file.'];
      if (!isUsdz(usdz)) errors.usdz = ['Not a USDZ file.'];
      if (Object.keys(errors).length) throw new ApiError('VALIDATION_FAILED', 'The AR files are not valid models.', { errors });
      // Scene Viewer rejects glTF extensions it does not implement: store a cleaned copy.
      await Promise.all([
        store.put(keys.glb, sceneViewerSafeGlb(glb), GLB.contentType, 'private, max-age=86400'),
        store.put(keys.usdz, usdz, USDZ.contentType, 'private, max-age=86400'),
      ]);
    }

    const host = c.get('host').name;
    const ttlSeconds = config.AR_URL_TTL_SECONDS;
    const [glbUrl, usdzUrl] = await Promise.all([
      adapters.assetSigner.signUrl({ host, path: `/${keys.glb}`, ttlSeconds }),
      adapters.assetSigner.signUrl({ host, path: `/${keys.usdz}`, ttlSeconds }),
    ]);
    return { ready: true, reused: stored, glbUrl: glbUrl.url, usdzUrl: usdzUrl.url, expiresAt: glbUrl.expiresAt.toISOString() };
  });
}
