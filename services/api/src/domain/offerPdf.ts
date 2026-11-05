import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { WATERMARK_TEXT } from '@saunaklar/shared';

export interface OfferPdfData {
  shop: { name: string; legalName: string | null; address: string | null; phone: string | null; email: string | null };
  vat: 'INCLUDED' | 'EXCLUDED' | 'NONE';
  label: string;
  version: number;
  createdAt: Date;
  contact: { personName: string; organisation: string | null; email: string | null; mobile: string | null };
  sauna: string;
  configuration: string;
  options: { group: string; name: string; priceMinor: number }[];
  currency: string;
  listPriceMinor: number;
  discountMinor: number;
  unitPriceMinor: number;
  quantity: number;
  lines: { label: string; amountMinor: number }[];
  totalMinor: number;
  comment: string | null;
  validUntil: Date | null;
}

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const INK = rgb(0.06, 0.09, 0.12);
const MUTED = rgb(0.38, 0.42, 0.47);

/** The standard PDF fonts only cover Latin-1; anything else (and control characters) becomes "?". */
const safe = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/[^ -~ -ÿ]/g, c => ({ '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '·': '-', '€': 'EUR' })[c] ?? '?');
const money = (minor: number, cur: string) => {
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${minor < 0 ? '-' : ''}${cur} ${whole}.${String(abs % 100).padStart(2, '0')}`;
};
const day = (d: Date) => d.toISOString().slice(0, 10);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/ {2,}|\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** One A4 PDF: shop, contact, sauna, itemised options, extra lines, total and comment; watermarked on every page. */
export async function buildOfferPdf(d: OfferPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.label} v${d.version}`);
  pdf.setProducer(WATERMARK_TEXT);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
  };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };
  const text = (t: string, x: number, size = 10, f = font, color = INK) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, size = 10, f = font) => page.drawText(safe(t), { x: A4[0] - M - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color: INK });
  const rule = () => page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4[0] - M, y: y + 4 }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });

  newPage();
  text(d.shop.name, M, 18, bold);
  right(`${d.label}  v${d.version}`, 18, bold);
  y -= 16;
  text([d.shop.legalName, d.shop.address?.replace(/\n/g, ', ')].filter(Boolean).join(' - '), M, 8, font, MUTED);
  right(day(d.createdAt), 9);
  y -= 11;
  text([d.shop.phone, d.shop.email].filter(Boolean).join('  '), M, 8, font, MUTED);
  y -= 30;

  text('Offer for', M, 8, font, MUTED);
  y -= 13;
  text(d.contact.personName, M, 12, bold);
  y -= 14;
  for (const l of [d.contact.organisation, d.contact.email, d.contact.mobile].filter(Boolean) as string[]) {
    text(l, M, 10);
    y -= 13;
  }
  y -= 12;

  text(d.sauna, M, 14, bold);
  y -= 14;
  if (d.configuration && d.configuration !== d.sauna) { text(d.configuration, M, 9, font, MUTED); y -= 12; }
  y -= 10;

  const row = (left: string, amount: string, f = font, size = 10) => {
    need(16);
    text(left, M, size, f);
    right(amount, size, f);
    y -= 15;
  };
  rule();
  y -= 8;
  row('Base price', money(d.listPriceMinor, d.currency));
  let group = '';
  for (const o of d.options) {
    if (o.group !== group) {
      group = o.group;
      need(26);
      y -= 4;
      text(o.group, M, 8, bold, MUTED);
      y -= 13;
    }
    row(`  ${o.name}`, o.priceMinor ? money(o.priceMinor, d.currency) : 'included');
  }
  if (d.discountMinor > 0) row('Discount', money(-d.discountMinor, d.currency));
  y -= 4;
  rule();
  y -= 10;
  row('Price per sauna', money(d.unitPriceMinor, d.currency), bold);
  if (d.quantity !== 1) row(`Quantity: ${d.quantity}`, money(d.unitPriceMinor * d.quantity, d.currency));
  for (const l of d.lines) row(l.label, money(l.amountMinor, d.currency));
  y -= 2;
  rule();
  y -= 12;
  row('Total', money(d.totalMinor, d.currency), bold, 13);
  const vat = d.vat === 'INCLUDED' ? 'Prices include VAT.' : d.vat === 'EXCLUDED' ? 'Prices exclude VAT.' : '';
  if (vat) { text(vat, M, 8, font, MUTED); y -= 12; }
  if (d.validUntil) { text(`Price valid until ${day(d.validUntil)}.`, M, 8, font, MUTED); y -= 12; }

  if (d.comment) {
    y -= 14;
    need(30);
    text('Comments', M, 8, bold, MUTED);
    y -= 13;
    for (const line of wrap(d.comment, font, 10, A4[0] - 2 * M)) {
      need(14);
      text(line, M, 10);
      y -= 13;
    }
  }

  // Watermark: diagonal text and a footer on every page, drawn when the file is made.
  pages.forEach((p, i) => {
    for (const [x, yy] of [[110, 220], [250, 470], [110, 720]] as const) {
      p.drawText(WATERMARK_TEXT, { x, y: yy, size: 64, font: bold, color: rgb(0.5, 0.55, 0.6), opacity: 0.13, rotate: degrees(32) });
    }
    p.drawText(safe(`${WATERMARK_TEXT} - ${d.label} v${d.version} - page ${i + 1}/${pages.length}`), { x: M, y: 24, size: 8, font, color: MUTED });
  });
  return pdf.save();
}
