import { Hono } from 'hono';
import type { AppEnv, Deps } from './context.ts';
import { notFoundHandler, onError, originLock, requestContext, securityHeaders } from './middleware/core.ts';
import { rateLimit } from './middleware/rateLimit.ts';
import { csrf, session } from './middleware/session.ts';
import { hostAndTenant, TenantCache } from './middleware/tenant.ts';
import { registerAdmin } from './routes/admin.ts';
import { registerQuotes } from './routes/quotes.ts';
import { registerInvoices } from './routes/invoices.ts';
import { registerAssets } from './routes/assets.ts';
import { registerAuth } from './routes/auth.ts';
import { registerCatalog } from './routes/catalog.ts';
import { registerPricing } from './routes/pricing.ts';
import { registerStaffAuth } from './routes/staffAuth.ts';

/** Builds the API: every route group is mounted in this one process. */
export function createApp(deps: Deps, tenantCache = new TenantCache()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requestContext, securityHeaders, originLock, hostAndTenant(tenantCache), session, csrf);
  app.use('/api/auth/*', rateLimit({ group: 'auth', windowMs: 60_000, max: 30 }));
  app.use('/api/shared/*', rateLimit({ group: 'shared', windowMs: 60_000, max: 60 }));
  app.use('/api/assets/*', rateLimit({ group: 'assets', windowMs: 60_000, max: 120 }));

  registerCatalog(app);
  registerAuth(app);
  registerStaffAuth(app);
  registerAdmin(app);
  registerQuotes(app);
  registerInvoices(app);
  registerPricing(app);
  registerAssets(app);

  app.get('/api/health', c => c.json({ ok: true }));
  // Readiness: the database answers. No detail in the body, errors go to the log only.
  app.get('/api/ready', async c => {
    try {
      await deps.pool.query('SELECT 1');
      return c.json({ ok: true });
    } catch (e) {
      deps.log.error('readiness check failed', { error: e instanceof Error ? e.message : String(e) });
      return c.json({ ok: false }, 503);
    }
  });
  app.notFound(notFoundHandler);
  app.onError(onError);
  return app;
}
