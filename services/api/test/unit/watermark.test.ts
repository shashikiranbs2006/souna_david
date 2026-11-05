import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildOfferPdf } from '../../src/domain/offerPdf.ts';
import { watermarkImage, watermarkSvg } from '../../src/domain/watermark.ts';

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } }).jpeg().toBuffer();

describe('watermarkImage', () => {
  it('returns a PNG of the same size with the stamp painted over it', async () => {
    const input = await solid(800, 600);
    const out = await watermarkImage(input, 'Keller Fjord');
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 800, height: 600 });
    const plain = await sharp(input).png().raw().toBuffer();
    const stamped = await sharp(out).raw().toBuffer();
    expect(Buffer.compare(plain, stamped)).not.toBe(0);
    // The corner stamp darkens the bottom strip; the middle is only lightly touched.
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => data[(y * info.width + x) * info.channels]!;
    expect(at(400, 590)).toBeLessThan(90);
    expect(at(20, 400)).toBeGreaterThan(110);
  });
  it('shrinks very large pictures and rejects non-pictures', async () => {
    const out = await watermarkImage(await solid(3000, 1000));
    expect((await sharp(out).metadata()).width).toBe(2000);
    await expect(watermarkImage(Buffer.from('not a picture'))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('escapes the label in the SVG', () => {
    expect(watermarkSvg(400, 300, '<b>&"')).toContain('&lt;b&gt;&amp;&quot;');
  });
});

describe('buildOfferPdf', () => {
  it('makes a PDF', async () => {
    const bytes = await buildOfferPdf({
      shop: { name: 'Holzsauna', legalName: 'Holzbau Boscheri GmbH', address: 'Hörhausen\nTG', phone: null, email: null },
      vat: 'INCLUDED', label: 'Q-1024', version: 2, createdAt: new Date('2026-11-05T10:00:00Z'),
      contact: { personName: 'Maria Müller', organisation: 'Keller AG', email: 'm@k.test', mobile: null },
      sauna: 'Fjord Panorama', configuration: 'Keller Fjord',
      options: [{ group: 'Wood', name: 'Thermo-aspen', priceMinor: 12000 }, { group: 'Door', name: 'Glass – bronze', priceMinor: 0 }],
      currency: 'CHF', listPriceMinor: 900000, discountMinor: 0, unitPriceMinor: 912000, quantity: 2,
      lines: [{ label: 'Delivery', amountMinor: 45000 }], totalMinor: 1869000, comment: 'Delivery in spring. '.repeat(200), validUntil: new Date('2026-12-05T00:00:00Z'),
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
  });
});
