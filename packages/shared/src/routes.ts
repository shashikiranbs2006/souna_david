import { z } from 'zod';
import * as admin from './admin.ts';
import * as ar from './ar.ts';
import * as auth from './auth.ts';
import * as catalog from './catalog.ts';
import { ok, page, pageQuery } from './common.ts';
import * as cfg from './configurations.ts';
import * as pricing from './pricing.ts';
import * as quo from './quotes.ts';
import * as share from './sharing.ts';

/**
 * Every API route in one table: the API mounts handlers against it and the
 * web client derives its typed calls from it, so the two cannot drift.
 * `fn` is the Lambda function that serves the route (design 4.2).
 */
export type LambdaFunction = 'public-catalog' | 'reseller-admin' | 'asset-signer';
/** `reseller-owner`: reseller staff with role OWNER only (shop settings, discounts, option prices). */
export type Access = 'public' | 'reseller-staff' | 'reseller-owner' | 'any-session';
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef {
  method: Method;
  path: string;
  fn: LambdaFunction;
  access: Access;
  host: 'storefront' | 'any';
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
  /** 201 for creations, 202 for accepted async work. */
  status?: 200 | 201 | 202 | 204;
  /** Largest JSON body this route accepts, when it needs more than the default 1 MB (file hand-offs). */
  maxBodyBytes?: number;
}

const r = <const T extends RouteDef>(d: T) => d;

export const routes = {
  // ---- public storefront ---------------------------------------------
  tenant: r({ method: 'GET', path: '/api/tenant', fn: 'public-catalog', access: 'public', host: 'storefront', response: catalog.tenantSchema }),
  catalog: r({ method: 'GET', path: '/api/catalog', fn: 'public-catalog', access: 'public', host: 'storefront', query: catalog.catalogVersionQuery, response: catalog.catalogSchema }),
  sauna: r({ method: 'GET', path: '/api/catalog/saunas/:slug', fn: 'public-catalog', access: 'public', host: 'storefront', query: catalog.catalogVersionQuery, response: catalog.saunaDetailSchema }),
  rooms: r({ method: 'GET', path: '/api/rooms', fn: 'public-catalog', access: 'public', host: 'storefront', query: catalog.catalogVersionQuery, response: catalog.roomsSchema }),
  shared: r({ method: 'GET', path: '/api/shared/:token', fn: 'public-catalog', access: 'public', host: 'storefront', response: share.sharedConfigurationSchema }),
  sharedActivity: r({ method: 'POST', path: '/api/shared/:token/activity', fn: 'public-catalog', access: 'public', host: 'storefront', body: quo.shareActivityRequest, response: ok }),
  sharedEnquiry: r({ method: 'POST', path: '/api/shared/:token/enquiry', fn: 'public-catalog', access: 'public', host: 'storefront', body: quo.shareEnquiryRequest, response: ok }),
  assetSession: r({ method: 'POST', path: '/api/assets/session', fn: 'asset-signer', access: 'public', host: 'storefront', body: catalog.assetSessionRequest, response: catalog.assetSessionResponse }),
  assetAr: r({ method: 'POST', path: '/api/assets/ar', fn: 'asset-signer', access: 'public', host: 'storefront', body: catalog.arRequest, response: catalog.arResponse }),
  sharedArFiles: r({ method: 'POST', path: '/api/shared/:token/ar-files', fn: 'asset-signer', access: 'public', host: 'storefront', body: ar.sharedArFilesRequest, response: ar.sharedArFilesResponse, maxBodyBytes: ar.AR_FILES_MAX_BODY_BYTES }),

  // ---- session (both hosts) -------------------------------------------
  session: r({ method: 'GET', path: '/api/auth/session', fn: 'public-catalog', access: 'public', host: 'any', response: auth.sessionSchema }),
  logout: r({ method: 'POST', path: '/api/auth/logout', fn: 'public-catalog', access: 'public', host: 'any', response: ok }),
  refresh: r({ method: 'POST', path: '/api/auth/refresh', fn: 'public-catalog', access: 'public', host: 'any', response: auth.sessionSchema }),

  // ---- staff auth ---------------------------------------------------------
  staffLogin: r({ method: 'POST', path: '/api/auth/staff/login', fn: 'reseller-admin', access: 'public', host: 'any', body: auth.staffLoginRequest, response: auth.staffChallengeResponse }),
  staffMfa: r({ method: 'POST', path: '/api/auth/staff/mfa', fn: 'reseller-admin', access: 'public', host: 'any', body: auth.staffMfaRequest, response: auth.staffChallengeResponse }),
  staffNewPassword: r({ method: 'POST', path: '/api/auth/staff/new-password', fn: 'reseller-admin', access: 'public', host: 'any', body: auth.staffNewPasswordRequest, response: auth.staffChallengeResponse }),

  // ---- reseller admin -----------------------------------------------------
  adminBranding: r({ method: 'GET', path: '/api/admin/branding', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.brandingSchema }),
  adminPatchBranding: r({ method: 'PATCH', path: '/api/admin/branding', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.brandingPatch, response: admin.brandingSchema }),
  adminCreateUpload: r({ method: 'POST', path: '/api/admin/branding/uploads', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.createUploadRequest, response: admin.createUploadResponse, status: 201 }),
  adminCompleteUpload: r({ method: 'POST', path: '/api/admin/branding/uploads/:uploadId/complete', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', response: admin.brandingSchema }),
  adminSettings: r({ method: 'GET', path: '/api/admin/settings', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.settingsSchema }),
  adminPatchSettings: r({ method: 'PATCH', path: '/api/admin/settings', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.settingsSchema, response: admin.settingsSchema }),
  adminSaunas: r({ method: 'GET', path: '/api/admin/saunas', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.adminSaunasSchema }),
  adminPatchSauna: r({ method: 'PATCH', path: '/api/admin/saunas/:id', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.adminSaunaPatch, response: admin.adminSaunaSchema }),
  adminSaunaOrder: r({ method: 'PUT', path: '/api/admin/saunas/order', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.adminSaunaOrder, response: admin.adminSaunasSchema }),
  adminPutSaunaDiscount: r({ method: 'PUT', path: '/api/admin/saunas/:id/discount', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.adminSaunaSchema.shape.discount.unwrap(), response: admin.adminSaunaSchema }),
  adminSaunaOptions: r({ method: 'GET', path: '/api/admin/saunas/:id/options', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: admin.adminSaunaOptionsSchema }),
  adminPutSaunaOptions: r({ method: 'PUT', path: '/api/admin/saunas/:id/options', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.adminSaunaOptionsPut, response: admin.adminSaunaOptionsSchema }),
  adminDeleteSaunaDiscount: r({ method: 'DELETE', path: '/api/admin/saunas/:id/discount', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', response: admin.adminSaunaSchema }),
  adminPutDefaultDiscount: r({ method: 'PUT', path: '/api/admin/discount', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: admin.adminSaunaSchema.shape.discount.unwrap(), response: admin.adminSaunasSchema }),
  adminDeleteDefaultDiscount: r({ method: 'DELETE', path: '/api/admin/discount', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', response: admin.adminSaunasSchema }),
  adminConfigurations: r({ method: 'GET', path: '/api/admin/configurations', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: pageQuery, response: page(cfg.configurationSummarySchema) }),
  adminCreateConfiguration: r({ method: 'POST', path: '/api/admin/configurations', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: cfg.createConfigurationRequest, response: cfg.configurationSchema, status: 201 }),
  adminConfiguration: r({ method: 'GET', path: '/api/admin/configurations/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: cfg.configurationSchema }),
  adminPutSelections: r({ method: 'PUT', path: '/api/admin/configurations/:id/selections', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: cfg.putSelectionsRequest, response: cfg.configurationSchema }),
  adminPutPlacement: r({ method: 'PUT', path: '/api/admin/configurations/:id/room', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: cfg.putPlacementRequest, response: cfg.configurationSchema }),
  adminShareLinks: r({ method: 'GET', path: '/api/admin/configurations/:id/share-links', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: share.shareLinksSchema }),
  adminCreateShareLink: r({ method: 'POST', path: '/api/admin/configurations/:id/share-links', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: share.createShareLinkRequest, response: share.createdShareLinkSchema, status: 201 }),
  adminRevokeShareLink: r({ method: 'DELETE', path: '/api/admin/configurations/:id/share-links/:linkId', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: share.shareLinkSchema }),
  adminContacts: r({ method: 'GET', path: '/api/admin/contacts', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: quo.contactListQuery, response: z.object({ items: z.array(quo.contactSchema) }) }),
  adminCreateContact: r({ method: 'POST', path: '/api/admin/contacts', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.contactInput, response: quo.contactSchema, status: 201 }),
  adminContact: r({ method: 'GET', path: '/api/admin/contacts/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: quo.contactSchema }),
  adminUpdateContact: r({ method: 'PATCH', path: '/api/admin/contacts/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.contactPatch, response: quo.contactSchema }),
  adminOffers: r({ method: 'GET', path: '/api/admin/offers', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: quo.offerListQuery, response: z.object({ items: z.array(quo.offerSummarySchema) }) }),
  adminCreateOffer: r({ method: 'POST', path: '/api/admin/offers', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.createOfferRequest, response: quo.offerSchema, status: 201 }),
  adminOffer: r({ method: 'GET', path: '/api/admin/offers/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: quo.offerSchema }),
  adminOfferVersion: r({ method: 'POST', path: '/api/admin/offers/:id/versions', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.offerVersionRequest, response: quo.offerSchema, status: 201 }),
  adminOfferTracking: r({ method: 'GET', path: '/api/admin/offers/:id/tracking', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: quo.offerTrackingSchema }),
  adminOfferPdf: r({ method: 'GET', path: '/api/admin/offers/:id/pdf', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: z.unknown() }),
  adminInvoices: r({ method: 'GET', path: '/api/admin/invoices', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', query: quo.invoiceListQuery, response: z.object({ items: z.array(quo.invoiceSummarySchema) }) }),
  adminCreateInvoice: r({ method: 'POST', path: '/api/admin/invoices', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.createInvoiceRequest, response: quo.invoiceSchema, status: 201 }),
  adminInvoice: r({ method: 'GET', path: '/api/admin/invoices/:id', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: quo.invoiceSchema }),
  adminInvoiceStatus: r({ method: 'POST', path: '/api/admin/invoices/:id/status', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.invoiceStatusRequest, response: quo.invoiceSchema }),
  adminInvoicePdf: r({ method: 'GET', path: '/api/admin/invoices/:id/pdf', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: z.unknown() }),
  adminReports: r({ method: 'GET', path: '/api/admin/reports', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', response: quo.reportsSchema }),
  adminWatermarkImage: r({ method: 'POST', path: '/api/admin/watermark-image', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.watermarkImageRequest, response: quo.watermarkedImageSchema }),
  adminSendOffer: r({ method: 'POST', path: '/api/admin/offers/:id/send', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.sendOfferRequest, response: quo.offerSchema }),
  adminOfferStatus: r({ method: 'POST', path: '/api/admin/offers/:id/status', fn: 'reseller-admin', access: 'reseller-staff', host: 'storefront', body: quo.offerStatusRequest, response: quo.offerSchema }),

  // ---- prices (the shop owner edits base price and largest discount of each sauna) ----------
  adminPricing: r({ method: 'GET', path: '/api/admin/pricing', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', response: pricing.pricingSchema }),
  adminPutPrice: r({ method: 'PUT', path: '/api/admin/pricing/:id', fn: 'reseller-admin', access: 'reseller-owner', host: 'storefront', body: pricing.putPriceRequest, response: pricing.pricingSchema }),
} as const satisfies Record<string, RouteDef>;

export type Routes = typeof routes;
export type RouteName = keyof Routes;
export type ResponseOf<N extends RouteName> = z.infer<Routes[N]['response']>;
export type BodyOf<N extends RouteName> = Routes[N] extends { body: infer B extends z.ZodType } ? z.input<B> : never;
export type QueryOf<N extends RouteName> = Routes[N] extends { query: infer Q extends z.ZodType } ? z.input<Q> : never;

/** Fills `:params` in a route path. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`missing path parameter ${k} for ${path}`);
    return encodeURIComponent(v);
  });
}
