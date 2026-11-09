import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

/** Regression tests for the API review (authz, races, caching, audit isolation). */
let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

describe('caching', () => {
  it('never puts a cookie on a response a shared cache may store', async () => {
    const fresh = h.client('alpha.localhost');
    const r = await fresh.get('/api/tenant');
    expect(r.headers.get('cache-control')).toContain('public');
    expect(r.headers.getSetCookie()).toEqual([]);
    // Private responses still establish the browser id.
    expect((await fresh.session()).headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it('shares a catalog response only when its language is in the URL', async () => {
    const c = h.client('alpha.localhost');
    const v = (await c.get('/api/tenant')).body.catalogVersion as number;
    const byHeader = await c.get(`/api/catalog?v=${v}`, { 'accept-language': 'de' });
    expect(byHeader.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const byQuery = await c.get(`/api/catalog?v=${v}&lang=de`);
    expect(byQuery.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(byQuery.headers.getSetCookie()).toEqual([]);
  });
});
