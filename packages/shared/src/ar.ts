import { z } from 'zod';
import { isoDateTime } from './common.ts';

/**
 * "View in your room" on a share link: the browser exports the exact configured
 * sauna (GLB for Android Scene Viewer, USDZ for iPhone Quick Look) and hands it
 * to the API once; the API stores it under a fingerprint of the configuration
 * and returns short-lived signed URLs the phone's own AR viewer can open.
 */

/** Largest AR file accepted, per file (decoded bytes). */
export const AR_FILE_MAX_BYTES = 12 * 1024 * 1024;
/** Base64 length of an AR_FILE_MAX_BYTES file, plus a little slack so the API (not the schema) answers 413. */
const AR_FILE_MAX_BASE64 = Math.ceil(AR_FILE_MAX_BYTES / 3) * 4 + 8;
/** Largest request body for POST /api/shared/:token/ar-files (two base64 files and the JSON around them). */
export const AR_FILES_MAX_BODY_BYTES = 2 * AR_FILE_MAX_BASE64 + 4096;

const base64File = z.string().min(24).max(AR_FILE_MAX_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Expected base64.');

/**
 * Without files the call only asks whether this configuration's AR files exist
 * (`ready: false` when they do not); with both files it stores them, unless an
 * identical configuration already has them.
 */
export const sharedArFilesRequest = z
  .object({ glb: base64File.optional(), usdz: base64File.optional() })
  .refine(b => (b.glb === undefined) === (b.usdz === undefined), { message: 'Send both files or neither.', path: ['usdz'] });
export type SharedArFilesRequest = z.infer<typeof sharedArFilesRequest>;

export const sharedArFilesResponse = z.object({
  ready: z.boolean(),
  /** True when the files were already stored (this call did not store anything). */
  reused: z.boolean(),
  glbUrl: z.string().nullable(),
  usdzUrl: z.string().nullable(),
  expiresAt: isoDateTime.nullable(),
});
export type SharedArFilesResponse = z.infer<typeof sharedArFilesResponse>;
