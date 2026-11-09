import { renderMail, type Block, type MailBrand, type RenderedMail } from './layout.ts';
import { singleLine } from './escape.ts';
import { INTL_LOCALE, MAIL_STRINGS, resolveMailLocale, type MailLocale, type MailStrings } from './i18n.ts';

export type { MailBrand, RenderedMail } from './layout.ts';
export { MAIL_LOCALES, resolveMailLocale, type MailLocale } from './i18n.ts';

/** Formats integer minor units with the currency's own fraction digits, Swiss conventions. */
export function formatMoney(amountMinor: number | bigint, currency: string, locale?: string | null): string {
  const fmt = new Intl.NumberFormat(INTL_LOCALE[resolveMailLocale(locale)], { style: 'currency', currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(Number(amountMinor) / 10 ** digits);
}

export function formatDate(value: Date | string, locale?: string | null): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[resolveMailLocale(locale)], { dateStyle: 'long', timeZone: 'Europe/Zurich' }).format(new Date(value));
}

export interface Money {
  amountMinor: number;
  currency: string;
}

type Ctx = { t: MailStrings; locale: MailLocale };

function build(
  brand: MailBrand,
  locale: string | null | undefined,
  compose: (ctx: Ctx) => { subject: string; preheader: string; blocks: Block[] },
): RenderedMail {
  const resolved = resolveMailLocale(locale);
  const out = compose({ t: MAIL_STRINGS[resolved], locale: resolved });
  return renderMail(brand, { locale: resolved, subject: singleLine(out.subject), preheader: singleLine(out.preheader), blocks: out.blocks });
}

const greet = (t: MailStrings, firstName?: string | null): Block => ({ kind: 'paragraph', text: t.greeting(firstName) });
const optionalQuote = (text?: string | null): Block[] => (text ? [{ kind: 'quote', text }] : []);

/**
 * Every template: `(brand, data, locale?)` → `{subject, html, text}`. `locale` is one of
 * en/de/fr/it (region suffixes accepted); anything else falls back to English.
 */
export const templates = {
  /** The offer a customer receives from the shop's admin: summary, the PDF attached, a view-only 3D link. */
  offerSent(
    brand: MailBrand,
    data: { firstName?: string | null; label: string; saunaName: string; total: Money; validUntil?: Date | string | null; comment?: string | null; viewUrl: string },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t, locale: l }) => {
      const total = formatMoney(data.total.amountMinor, data.total.currency, l);
      const until = data.validUntil ? formatDate(data.validUntil, l) : null;
      return {
        subject: t.offerSent.subject(brand.brandName, data.label),
        preheader: t.offerSent.preheader(total),
        blocks: [
          { kind: 'heading', text: t.offerSent.heading },
          greet(t, data.firstName),
          { kind: 'paragraph', text: t.offerSent.body(brand.brandName, data.saunaName) },
          {
            kind: 'facts',
            rows: [
              [t.offerSent.offerNumber, data.label],
              [t.labels.sauna, data.saunaName],
              [t.labels.quotedPrice, total],
              ...(until ? ([[t.labels.validUntil, until]] as [string, string][]) : []),
            ],
          },
          ...optionalQuote(data.comment),
          { kind: 'button', label: t.offerSent.cta, url: data.viewUrl },
          ...(until ? ([{ kind: 'note', text: t.offerSent.note(until) }] as Block[]) : []),
        ],
      };
    });
  },

  /** A customer's question from the customer link, sent to the shop. Reply-To is the customer. */
  enquiry(
    brand: MailBrand,
    data: { name: string; email: string; phone?: string | null; message: string; saunaName?: string | null; linkUrl: string },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t }) => ({
      subject: t.enquiry.subject(data.name),
      preheader: t.enquiry.preheader(data.name),
      blocks: [
        { kind: 'heading', text: t.enquiry.heading },
        { kind: 'paragraph', text: t.enquiry.body(data.name) },
        {
          kind: 'facts',
          rows: [
            [t.enquiry.name, data.name],
            [t.labels.email, data.email],
            ...(data.phone ? ([[t.enquiry.phone, data.phone]] as [string, string][]) : []),
            ...(data.saunaName ? ([[t.labels.sauna, data.saunaName]] as [string, string][]) : []),
          ],
        },
        { kind: 'quote', text: data.message },
        { kind: 'button', label: t.enquiry.cta, url: data.linkUrl },
      ],
    }));
  },

  staffInvite(
    brand: MailBrand,
    data: { email: string; temporaryPassword: string; adminUrl: string; displayName?: string | null },
    locale?: string | null,
  ): RenderedMail {
    return build(brand, locale, ({ t }) => ({
      subject: t.staffInvite.subject(brand.brandName),
      preheader: t.staffInvite.preheader,
      blocks: [
        { kind: 'heading', text: t.staffInvite.heading(brand.brandName) },
        greet(t, data.displayName),
        { kind: 'paragraph', text: t.staffInvite.body },
        { kind: 'facts', rows: [[t.labels.email, data.email]] },
        { kind: 'code', code: data.temporaryPassword },
        { kind: 'button', label: t.staffInvite.signIn, url: data.adminUrl },
        { kind: 'paragraph', text: t.staffInvite.mfa },
        { kind: 'note', text: t.staffInvite.note },
      ],
    }));
  },
};
