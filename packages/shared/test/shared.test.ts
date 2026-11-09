import { describe, expect, it } from 'vitest';
import { buildPath, ERROR_CODES, ERROR_STATUS, parseHost, routes, storefrontHost } from '../src/index.ts';

const cfg = { platformDomain: 'saunas.example.com' };

describe('parseHost', () => {
  it('resolves storefront and platform hosts', () => {
    expect(parseHost('alpha-spa.saunas.example.com', cfg)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('ALPHA.saunas.example.com:443', cfg)).toEqual({ kind: 'storefront', slug: 'alpha' });
    expect(parseHost('saunas.example.com', cfg)).toEqual({ kind: 'platform' });
    expect(parseHost('www.saunas.example.com', cfg)).toEqual({ kind: 'platform' });
  });
  it('rejects anything else', () => {
    for (const h of ['a.b.saunas.example.com', 'evil.com', '-x.saunas.example.com', 'x-.saunas.example.com', '', null, 'a..saunas.example.com', 'saunas.example.com.evil.com', 'x_y.saunas.example.com']) {
      expect(parseHost(h, cfg).kind).toBe('unknown');
    }
  });
  it('works for local development hosts', () => {
    const local = { platformDomain: 'localhost' };
    expect(parseHost('alpha.localhost:5173', local)).toEqual({ kind: 'storefront', slug: 'alpha' });
  });
});

describe('single-shop edition', () => {
  const single = { platformDomain: 'offers.holzsauna.ch', singleShop: 'holzsauna' };
  it('serves the one shop on every host', () => {
    for (const h of ['offers.holzsauna.ch', 'www.holzsauna.ch', 'localhost:5173', 'alpha.saunas.example.com', 'admin.example.com']) {
      expect(parseHost(h, single)).toEqual({ kind: 'storefront', slug: 'holzsauna' });
    }
    expect(parseHost('', single).kind).toBe('unknown');
    expect(parseHost('x', { ...single, singleShop: 'Bad Slug' }).kind).toBe('unknown');
  });
  it('builds share links on the shop domain itself', () => {
    expect(storefrontHost('holzsauna', single)).toBe('offers.holzsauna.ch');
    expect(storefrontHost('alpha', cfg)).toBe('alpha.saunas.example.com');
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
  it('builds paths and encodes params', () => {
    expect(buildPath(routes.sauna.path, { slug: 'a b' })).toBe('/api/catalog/saunas/a%20b');
    expect(() => buildPath(routes.sauna.path)).toThrow(/slug/);
  });
});
