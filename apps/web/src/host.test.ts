import { describe, expect, it } from 'vitest';
import { parseHost, resolveHostConfig } from './host.ts';

describe('resolveHostConfig', () => {
  it('prefers runtime config over build env, then falls back to localhost', () => {
    expect(resolveHostConfig({ platformDomain: 'a.com' }, { VITE_PLATFORM_DOMAIN: 'b.com' })).toEqual({ platformDomain: 'a.com' });
    expect(resolveHostConfig({}, { VITE_PLATFORM_DOMAIN: 'b.com' })).toEqual({ platformDomain: 'b.com' });
    expect(resolveHostConfig(undefined, {})).toEqual({ platformDomain: 'localhost' });
    expect(resolveHostConfig(undefined, { VITE_SINGLE_SHOP: 'holzsauna' })).toEqual({ platformDomain: 'localhost', singleShop: 'holzsauna' });
  });
});

const local = { platformDomain: 'localhost' };
const prod = { platformDomain: 'saunaklar.com' };

describe('parseHost (local)', () => {
  it('resolves a storefront from a single subdomain label, ignoring port and case', () => {
    expect(parseHost('alpha-spa.localhost:5173', local)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('Alpha-Spa.LOCALHOST', local)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('a.localhost', local)).toEqual({ kind: 'storefront', slug: 'a' });
    expect(parseHost(`${'a'.repeat(32)}.localhost`, local)).toEqual({ kind: 'storefront', slug: 'a'.repeat(32) });
  });

  it('serves the platform page on the bare domain and www', () => {
    expect(parseHost('localhost:5173', local)).toEqual({ kind: 'platform', reason: 'root' });
    expect(parseHost('www.localhost', local)).toEqual({ kind: 'platform', reason: 'root' });
  });

  it('rejects reserved slugs', () => {
    expect(parseHost('api.localhost', local)).toEqual({ kind: 'platform', reason: 'reserved-slug', attempted: 'api' });
    expect(parseHost('status.localhost:5173', local)).toMatchObject({ kind: 'platform', reason: 'reserved-slug' });
  });

  it('rejects malformed slugs, nested subdomains and foreign hosts', () => {
    for (const h of ['-bad.localhost', 'bad-.localhost', 'under_score.localhost', `${'a'.repeat(33)}.localhost`,
      'x.alpha.localhost', '127.0.0.1:5173', 'evil-localhost', '', '[::1]:5173']) {
      expect(parseHost(h, local), h).toMatchObject({ kind: 'platform', reason: 'unknown-host' });
    }
  });
});

describe('parseHost (production)', () => {
  it('uses the configured platform domain', () => {
    expect(parseHost('alpha-spa.saunaklar.com', prod)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('saunaklar.com', prod)).toEqual({ kind: 'platform', reason: 'root' });
    expect(parseHost('other.example.org', prod)).toMatchObject({ kind: 'platform', reason: 'unknown-host' });
    expect(parseHost('alpha-spa.saunaklar.com.evil.io', prod)).toMatchObject({ kind: 'platform', reason: 'unknown-host' });
  });

  it('treats `admin` as a reserved shop name', () => {
    expect(parseHost('admin.saunaklar.com', prod)).toMatchObject({ kind: 'platform', reason: 'reserved-slug' });
  });
});

