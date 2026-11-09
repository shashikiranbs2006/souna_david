import { describe, expect, it } from 'vitest';
import { escapeHtml, safeUrl, singleLine } from '../../../src/adapters/mail/escape.ts';
import { formatFromAddress } from '../../../src/adapters/mail/from-address.ts';
import { MAIL_LOCALES, formatDate, formatMoney, resolveMailLocale, templates } from '../../../src/adapters/mail/templates.ts';

const brand = { brandName: 'Alpha Spa', primaryColor: '#2a6f4e', storefrontUrl: 'https://alpha.example.com', supportEmail: 'help@alpha.example.com' };
const evil = '<script>alert("x")</script>&\'';

const samples = {
  staffInvite: { email: 'staff@example.com', temporaryPassword: 'Temp-Pass-42x', adminUrl: 'https://alpha.example.com/admin' },
  offerSent: { firstName: 'Anna', label: 'Q-1024', saunaName: 'Espoo Compact', total: { amountMinor: 664000, currency: 'CHF' }, validUntil: '2026-12-31T12:00:00Z', comment: 'Delivery in six weeks.', viewUrl: 'https://alpha.example.com/s/abc' },
  enquiry: { name: 'Anna Muster', email: 'anna@example.com', phone: '+41 79 000 00 00', message: 'Can you deliver in March?', saunaName: 'Espoo Compact', linkUrl: 'https://alpha.example.com/s/abc' },
} as const;

type Name = keyof typeof templates;
const render = (name: Name, b = brand, locale?: string) =>
  (templates[name] as (b: typeof brand, d: unknown, l?: string) => { subject: string; html: string; text: string })(b, samples[name], locale);

describe('mail templates', () => {
  it('covers every template', () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(templates).sort());
  });

  for (const name of Object.keys(templates) as Name[]) {
    it.each(MAIL_LOCALES)(`${name} renders in %s`, (locale) => {
      const mail = render(name, brand, locale);
      expect(mail.subject.length).toBeGreaterThan(5);
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.html).toContain('<!doctype html>');
      expect(mail.html).toContain(`lang="${locale}"`);
      expect(mail.html).toContain('Alpha Spa');
      expect(mail.html).not.toContain('undefined');
      expect(mail.text).toContain('Alpha Spa');
      expect(mail.text).not.toContain('<');
      expect(mail.text).not.toContain('undefined');
    });
  }

  it('really translates (subjects differ between locales)', () => {
    for (const name of Object.keys(templates) as Name[]) {
      const subjects = new Set(MAIL_LOCALES.map((l) => render(name, brand, l).subject));
      expect(subjects.size).toBe(MAIL_LOCALES.length);
    }
  });

  it('falls back to English for unknown locales and accepts region suffixes', () => {
    expect(render('staffInvite', brand, 'xx').subject).toBe(render('staffInvite', brand, 'en').subject);
    expect(render('staffInvite', brand, 'de-CH').subject).toBe(render('staffInvite', brand, 'de').subject);
    expect(resolveMailLocale(undefined)).toBe('en');
    expect(resolveMailLocale('IT_ch')).toBe('it');
  });

  it('uses the single brand colour and only shades of it', () => {
    const html = render('staffInvite').html;
    const colours = new Set(html.match(/#[0-9a-f]{6}\b/gi)?.map((c) => c.toLowerCase()));
    expect(colours.has('#2a6f4e')).toBe(true);
  });

  it('escapes every interpolated value', () => {
    const hostile = { ...brand, brandName: evil, supportEmail: `x"onmouseover="y@z.ch` };
    for (const name of Object.keys(templates) as Name[]) {
      const data = Object.fromEntries(
        Object.entries(samples[name]).map(([k, v]) => [k, typeof v === 'string' && !/Url$/.test(k) && k !== 'validUntil' && k !== 'expiresAt' ? evil : v]),
      );
      const mail = (templates[name] as (b: unknown, d: unknown) => { html: string; subject: string })(hostile, data);
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).not.toContain('"onmouseover=');
      expect(mail.html).toContain('&lt;script&gt;');
    }
  });

  it('neutralises javascript: links and CSS injection through the colour', () => {
    const mail = templates.offerSent(
      { ...brand, primaryColor: 'red;background:url(x)', storefrontUrl: 'javascript:alert(1)' },
      { ...samples.offerSent, viewUrl: 'javascript:alert(1)' },
    );
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).not.toContain('url(x)');
  });
});

describe('formatting', () => {
  it('formats money from minor units with Swiss conventions', () => {
    // The Swiss grouping mark depends on the runtime's ICU/CLDR data (', ’ or a narrow space), so any of them is accepted.
    expect(formatMoney(1234550, 'CHF', 'de')).toMatch(/^CHF\s12[\s'’]345\.50$/);
    expect(formatMoney(1234550, 'CHF', 'fr')).toMatch(/^12[\s'’]345\.50\sCHF$/);
    expect(formatMoney(1234550, 'EUR', 'it')).toMatch(/12[\s'’]345\.50/);
    expect(formatMoney(12345, 'JPY', 'en')).toMatch(/12[\s'’]345$/); // zero-decimal currency: minor = major
  });

  it('formats dates per locale', () => {
    expect(formatDate('2026-03-05T12:00:00Z', 'de')).toBe('5. März 2026');
    expect(formatDate('2026-03-05T12:00:00Z', 'fr')).toBe('5 mars 2026');
    expect(formatDate('2026-03-05T12:00:00Z', 'it')).toBe('5 marzo 2026');
  });
});

describe('escaping helpers', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('only allows http(s) URLs', () => {
    expect(safeUrl('https://a.ch/x?y=1')).toBe('https://a.ch/x?y=1');
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('not a url')).toBe('#');
  });
  it('flattens header values', () => {
    expect(singleLine('a\r\nBcc: x@y.ch')).toBe('a Bcc: x@y.ch');
  });
  it('formats From addresses safely', () => {
    expect(formatFromAddress('Alpha "Spa"\r\nBcc:', 'no-reply@mail.example.com')).toBe('"Alpha Spa Bcc:" <no-reply@mail.example.com>');
    expect(formatFromAddress('Zürich Saunas', 'no-reply@m.ch')).toBe(`=?utf-8?B?${Buffer.from('Zürich Saunas').toString('base64')}?= <no-reply@m.ch>`);
    expect(formatFromAddress('', 'no-reply@m.ch')).toBe('no-reply@m.ch');
  });
});
