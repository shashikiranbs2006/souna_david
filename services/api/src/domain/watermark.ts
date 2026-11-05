import sharp from 'sharp';
import { WATERMARK_TEXT } from '@saunaklar/shared';
import { ApiError } from '../lib/problem.ts';

const MAX_SIDE = 2000;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Text tiles over the whole picture plus a stamp in the corner, as one SVG layer. */
export function watermarkSvg(width: number, height: number, label: string | undefined): string {
  const step = Math.max(160, Math.round(Math.min(width, height) / 3.2));
  const font = Math.max(18, Math.round(step / 5));
  const tiles: string[] = [];
  for (let y = -step; y < height + step; y += step) {
    for (let x = -step; x < width + step; x += step * 1.6) {
      tiles.push(`<text x="${x + ((y / step) % 2 ? step * 0.8 : 0)}" y="${y}" transform="rotate(-24 ${x} ${y})">${esc(WATERMARK_TEXT)}</text>`);
    }
  }
  const stamp = esc(label ? `${WATERMARK_TEXT} · ${label}` : WATERMARK_TEXT);
  const sf = Math.max(14, Math.round(width / 70));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <g font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${font}" fill="#ffffff" fill-opacity="0.34" stroke="#10161c" stroke-opacity="0.22" stroke-width="1">${tiles.join('')}</g>
  <rect x="0" y="${height - sf * 2.2}" width="${width}" height="${sf * 2.2}" fill="#10161c" fill-opacity="0.62"/>
  <text x="${sf}" y="${height - sf * 0.7}" font-family="Helvetica, Arial, sans-serif" font-size="${sf}" fill="#ffffff">${stamp}</text>
</svg>`;
}

/** Decodes a picture (JPEG or PNG), limits its size and returns it as a watermarked PNG. */
export async function watermarkImage(data: Buffer, label?: string): Promise<Buffer> {
  try {
    const base = sharp(data, { limitInputPixels: 4096 * 4096, failOn: 'error' }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
    const { data: flat, info } = await base.flatten({ background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
    return await sharp(flat).composite([{ input: Buffer.from(watermarkSvg(info.width, info.height, label)), top: 0, left: 0 }]).png().toBuffer();
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'The picture could not be read. Send a PNG or JPEG.');
  }
}
