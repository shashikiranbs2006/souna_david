import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { WATERMARK_TEXT } from '@saunaklar/shared';

export interface InvoicePdfData {
  shop: { name: string; legalName: string | null; address: string | null; phone: string | null; email: string | null };
  vat: 'INCLUDED' | 'EXCLUDED' | 'NONE';
  label: string;
  quoteLabel: string;
  status: 'ISSUED' | 'PAID' | 'CANCELLED';
  issuedOn: string;
  dueOn: string;
  contact: { personName: string; organisation: string | null; email: string | null };
  currency: string;
  percent: number;
  quoteTotalMinor: number;
  amountMinor: number;
  paymentDetails: string | null;
  note: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const INK = rgb(0.06, 0.09, 0.12);
const MUTED = rgb(0.38, 0.42, 0.47);
const safe = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/[^ -~ -ÿ]/g, c => ({ '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '·': '-', '€': 'EUR' })[c] ?? '?');
const money = (minor: number, cur: string) => {
  const whole = String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${cur} ${whole}.${String(minor % 100).padStart(2, '0')}`;
};

/** One A4 prepayment invoice, watermarked like every other download. */
export async function buildInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.label);
  pdf.setProducer(WATERMARK_TEXT);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage(A4);
  let y = A4[1] - M;
  const text = (t: string, x: number, size = 10, f = font, color = INK) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, size = 10, f = font) => page.drawText(safe(t), { x: A4[0] - M - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color: INK });
  const rule = () => page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4[0] - M, y: y + 4 }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });
  const lines = (t: string) => { for (const l of safe(t).split(/ {2,}/).flatMap(p => p.match(/.{1,95}(\s|$)/g) ?? [p])) { text(l.trim(), M, 10); y -= 13; } };

  text(d.shop.name, M, 18, bold);
  right(`Invoice ${d.label}`, 18, bold);
  y -= 16;
  text([d.shop.legalName, d.shop.address?.replace(/\n/g, ', ')].filter(Boolean).join(' - '), M, 8, font, MUTED);
  right(`Issued ${d.issuedOn}`, 9);
  y -= 11;
  text([d.shop.phone, d.shop.email].filter(Boolean).join('  '), M, 8, font, MUTED);
  right(`Due ${d.dueOn}`, 9, bold);
  y -= 30;

  text('Invoice to', M, 8, font, MUTED);
  y -= 13;
  text(d.contact.personName, M, 12, bold);
  y -= 14;
  for (const l of [d.contact.organisation, d.contact.email].filter(Boolean) as string[]) { text(l, M, 10); y -= 13; }
  y -= 20;

  rule();
  y -= 8;
  text(`Prepayment of ${d.percent}% for offer ${d.quoteLabel}`, M, 11);
  y -= 16;
  text('Offer total', M, 10, font, MUTED);
  right(money(d.quoteTotalMinor, d.currency), 10);
  y -= 18;
  rule();
  y -= 12;
  text('Amount due', M, 13, bold);
  right(money(d.amountMinor, d.currency), 13, bold);
  y -= 16;
  const vat = d.vat === 'INCLUDED' ? 'Amount includes VAT.' : d.vat === 'EXCLUDED' ? 'Amount excludes VAT.' : '';
  if (vat) { text(vat, M, 8, font, MUTED); y -= 12; }
  if (d.status === 'PAID') { y -= 6; text('PAID - thank you.', M, 11, bold); y -= 14; }
  if (d.status === 'CANCELLED') { y -= 6; text('CANCELLED', M, 11, bold); y -= 14; }

  if (d.paymentDetails) {
    y -= 14;
    text('Payment details', M, 8, bold, MUTED);
    y -= 13;
    lines(d.paymentDetails);
  }
  if (d.note) {
    y -= 14;
    text('Note', M, 8, bold, MUTED);
    y -= 13;
    lines(d.note);
  }
  for (const [x, yy] of [[110, 220], [250, 470], [110, 720]] as const) {
    page.drawText(WATERMARK_TEXT, { x, y: yy, size: 64, font: bold, color: rgb(0.5, 0.55, 0.6), opacity: 0.13, rotate: degrees(32) });
  }
  page.drawText(safe(`${WATERMARK_TEXT} - ${d.label}`), { x: M, y: 24, size: 8, font, color: MUTED });
  return pdf.save();
}
