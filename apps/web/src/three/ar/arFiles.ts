import { api } from '../../api/client.ts';
import type { ViewerOptions, ViewerSpecs } from '../types.ts';

/**
 * The AR files for a share link: asks the API whether this configuration's
 * files exist, and only when they do not, exports the configured sauna in the
 * browser and hands it over once. The phone's AR viewers need real HTTPS file
 * URLs (blob: URLs do not open in Quick Look or Scene Viewer), so the API
 * stores the files and returns short-lived signed URLs.
 *
 * Cached in memory per link for this visit: the export runs at most once, and
 * expired URLs are refreshed with a cheap call (the files are already stored).
 */
export interface ArUrls {
  glbUrl: string;
  usdzUrl: string;
  expiresAt: number;
}

const urls = new Map<string, Promise<ArUrls>>();

/** Base64 of a binary, via a data: URL (fast in browsers, no huge strings built by hand). */
function toBase64(data: ArrayBuffer | Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the AR file.'));
    reader.readAsDataURL(new Blob([data as BlobPart]));
  });
}

async function fetchUrls(token: string, specs: ViewerSpecs, options: ViewerOptions): Promise<ArUrls> {
  const params = { token };
  let r = await api('sharedArFiles', { params, body: {} });
  if (!r.ready) {
    const { exportArModel } = await import('./exportArModel.ts');
    const files = await exportArModel(specs, options);
    const [glb, usdz] = await Promise.all([toBase64(files.glb), toBase64(files.usdz)]);
    r = await api('sharedArFiles', { params, body: { glb, usdz } });
  }
  if (!r.ready || !r.glbUrl || !r.usdzUrl || !r.expiresAt) throw new Error('The AR files are not available.');
  return { glbUrl: r.glbUrl, usdzUrl: r.usdzUrl, expiresAt: Date.parse(r.expiresAt) };
}

/** Signed URLs for this link's AR files, exporting them first when needed. */
export async function ensureArFiles(token: string, specs: ViewerSpecs, options: ViewerOptions): Promise<ArUrls> {
  const cached = urls.get(token);
  if (cached) {
    try {
      const u = await cached;
      // Keep a minute of slack: the viewer downloads the file after the tap.
      if (u.expiresAt - Date.now() > 60_000) return u;
    } catch {
      /* failed before: try again */
    }
  }
  const next = fetchUrls(token, specs, options);
  urls.set(token, next);
  next.catch(() => {
    if (urls.get(token) === next) urls.delete(token);
  });
  return next;
}
