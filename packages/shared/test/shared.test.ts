import { describe, expect, it } from 'vitest';
import { buildPath, CUSTOMER_TRANSITIONS, ERROR_CODES, ERROR_STATUS, isCustomerAccountRoute, parseHost, routes, storefrontHost, signupRequest, STAFF_TRANSITIONS } from '../src/index.ts';

const cfg = { platformDomain: 'saunas.example.com', adminHost: 'admin.example-admin.com' };

describe('parseHost', () => {
  it('resolves storefront, manufacturer and platform hosts', () => {
    expect(parseHost('alpha-spa.saunas.example.com', cfg)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('ALPHA.saunas.example.com:443', cfg)).toEqual({ kind: 'storefront', slug: 'alpha' });
    expect(parseHost('admin.example-admin.com', cfg)).toEqual({ kind: 'manufacturer' });
    expect(parseHost('saunas.example.com', cfg)).toEqual({ kind: 'platform' });
    expect(parseHost('www.saunas.example.com', cfg)).toEqual({ kind: 'platform' });
  });
  it('rejects anything else', () => {
    for (const h of ['a.b.saunas.example.com', 'evil.com', '-x.saunas.example.com', 'x-.saunas.example.com', '', null, 'a..saunas.example.com', 'saunas.example.com.evil.com', 'x_y.saunas.example.com']) {
      expect(parseHost(h, cfg).kind).toBe('unknown');
    }
  });
  it('works for local development hosts', () => {
    const local = { platformDomain: 'localhost', adminHost: 'admin.localhost' };
    expect(parseHost('alpha.localhost:5173', local)).toEqual({ kind: 'storefront', slug: 'alpha' });
    expect(parseHost('admin.localhost:5173', local)).toEqual({ kind: 'manufacturer' });
  });
});

describe('single-shop edition', () => {
  const single = { platformDomain: 'offers.holzsauna.ch', adminHost: 'admin.example-admin.com', singleShop: 'holzsauna' };
  it('serves the one shop on every host but the (switched off) admin host', () => {
    for (const h of ['offers.holzsauna.ch', 'www.holzsauna.ch', 'localhost:5173', 'alpha.saunas.example.com']) {
      expect(parseHost(h, single)).toEqual({ kind: 'storefront', slug: 'holzsauna' });
    }
    expect(parseHost('admin.example-admin.com', single)).toEqual({ kind: 'unknown' });
    expect(parseHost('admin.example-admin.com', { ...single, singleShop: undefined })).toEqual({ kind: 'manufacturer' });
    expect(parseHost('', single).kind).toBe('unknown');
    expect(parseHost('x', { ...single, singleShop: 'Bad Slug' }).kind).toBe('unknown');
  });
  it('builds share links on the shop domain itself', () => {
    expect(storefrontHost('holzsauna', single)).toBe('offers.holzsauna.ch');
    expect(storefrontHost('alpha', cfg)).toBe('alpha.saunas.example.com');
  });
  it('marks exactly the customer-account routes', () => {
    const names = Object.entries(routes).filter(([, d]) => isCustomerAccountRoute(d)).map(([n]) => n);
    for (const n of ['signup', 'login', 'confirm', 'resendCode', 'forgotPassword', 'resetPassword', 'me', 'configurations', 'claimShared', 'myRequests']) expect(names).toContain(n);
    for (const n of ['session', 'logout', 'refresh', 'staffLogin', 'staffMfa', 'catalog', 'sauna', 'shared', 'tenant', 'adminConfigurations']) expect(names).not.toContain(n);
  });
});

describe('contract tables', () => {
  it('maps every error code to a status', () => {
    for (const c of ERROR_CODES) expect(ERROR_STATUS[c]).toBeGreaterThanOrEqual(400);
  });
  it('has unique method+path pairs', () => {
    const keys = Object.values(routes).map(r => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('keeps terminal statuses terminal for every actor', () => {
    for (const s of ['CLOSED', 'REJECTED', 'CANCELLED'] as const) {
      expect(STAFF_TRANSITIONS[s]).toEqual([]);
      expect(CUSTOMER_TRANSITIONS[s]).toEqual([]);
    }
  });
  it('builds paths and encodes params', () => {
    expect(buildPath(routes.sauna.path, { slug: 'a b' })).toBe('/api/catalog/saunas/a%20b');
    expect(() => buildPath(routes.sauna.path)).toThrow(/slug/);
  });
});

describe('signupRequest', () => {
  const base = { email: 'a@b.test', password: 'Sauna!2026x', firstName: 'A', lastName: 'B', consents: { terms: true, privacy: true } };
  it('accepts a valid sign-up and defaults', () => {
    const v = signupRequest.parse(base);
    expect(v.locale).toBe('en');
    expect(v.consents.marketing).toBe(false);
  });
  it('requires terms and a strong password', () => {
    expect(signupRequest.safeParse({ ...base, consents: { terms: false, privacy: true } }).success).toBe(false);
    expect(signupRequest.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(signupRequest.safeParse({ ...base, password: 'alllowercase1234' }).success).toBe(false);
  });
});
