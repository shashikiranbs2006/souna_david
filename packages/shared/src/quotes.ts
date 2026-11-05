import { z } from 'zod';
import { isoDateTime, uuid } from './common.ts';
import { configurationSchema } from './configurations.ts';

// ---- Contacts and quotes (reseller admin; David edition) ------------------

const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const contactInput = z.object({
  personName: z.string().trim().min(1).max(200),
  organisation: optText(200),
  email: z.email().max(254).nullable().optional(),
  mobile: optText(40),
  notes: optText(4000),
});
export const contactPatch = contactInput.partial();

export const contactSchema = z.object({
  id: uuid,
  personName: z.string(),
  organisation: z.string().nullable(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  notes: z.string().nullable(),
  quotes: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const contactListQuery = z.object({ q: z.string().trim().max(200).optional() });

export const offerStatus = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED']);
/** Extra priced line next to the sauna (delivery, installation, ...). Negative = discount. */
export const offerLineInput = z.object({
  label: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});
export const offerBody = z.object({
  quantity: z.number().int().min(1).max(99).default(1),
  comment: optText(4000),
  lines: z.array(offerLineInput).max(20).default([]),
});

export const createOfferRequest = offerBody.extend({ contactId: uuid, configurationId: uuid });
/** A new version of a number: every field optional, the rest carries over. */
export const offerVersionRequest = z.object({
  configurationId: uuid.optional(),
  quantity: offerBody.shape.quantity.unwrap().optional(),
  comment: offerBody.shape.comment,
  lines: offerBody.shape.lines.unwrap().optional(),
});
export const offerStatusRequest = z.object({ status: offerStatus });
export const offerListQuery = z.object({ contactId: uuid.optional() });

export const offerSummarySchema = z.object({
  id: uuid,
  number: z.number().int(),
  /** Display form, e.g. Q-1024. */
  label: z.string(),
  version: z.number().int(),
  status: offerStatus,
  contact: z.object({ id: uuid, personName: z.string(), organisation: z.string().nullable() }),
  configuration: z.object({ id: uuid, name: z.string() }),
  quantity: z.number().int(),
  createdAt: isoDateTime,
});
export const offerSchema = offerSummarySchema.extend({
  comment: z.string().nullable(),
  lines: z.array(offerLineInput),
  currency: z.string(),
  unitPriceMinor: z.number().int(),
  totalMinor: z.number().int(),
  sauna: configurationSchema.shape.sauna,
  /** All versions of this number, newest first. */
  versions: z.array(z.object({ id: uuid, version: z.number().int(), status: offerStatus, createdAt: isoDateTime })),
});

export const QUOTE_FIRST_NUMBER = 1024;
export const quoteLabel = (n: number): string => `Q-${n}`;

// ---- Share-link tracking and the likelihood score ---------------------------

export const likelihoodLevel = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
export const likelihoodReason = z.enum(['OPENED', 'RETURNED', 'INSIDE_VIEW', 'LONG_VISIT', 'MULTIPLE_VISITORS', 'OPENED_QUICKLY', 'NOT_OPENED', 'EXPIRING_UNOPENED']);
export const offerTrackingSchema = z.object({
  /** The newest share link of the quote's configuration; null until David has shared it. */
  link: z.object({ id: uuid, createdAt: isoDateTime, expiresAt: isoDateTime, revoked: z.boolean() }).nullable(),
  opens: z.number().int(),
  lastOpenedAt: isoDateTime.nullable(),
  visitors: z.number().int(),
  insideViewOpened: z.boolean(),
  longestVisitSeconds: z.number().int(),
  recent: z.array(z.object({ viewedAt: isoDateTime, device: z.enum(['MOBILE', 'TABLET', 'DESKTOP', 'OTHER']), network: z.string().nullable() })),
  score: z.object({
    points: z.number().int(),
    level: likelihoodLevel,
    reasons: z.array(z.object({ code: likelihoodReason, points: z.number().int() })),
  }),
});
/** Sent by the share page while it is open; the server keeps the largest values per visit. */
export const shareActivityRequest = z.object({
  visitId: uuid,
  insideView: z.boolean(),
  seconds: z.number().int().min(0).max(3600),
});

// ---- Watermark and downloads -------------------------------------------------

/** Stamped on every downloaded file (server side) and over the live 3D view of the shop. */
export const WATERMARK_TEXT = 'SaunaKlar';
/** A picture taken from the 3D view (JPEG or PNG, base64). The server stamps it and sends it back. */
export const watermarkImageRequest = z.object({
  image: z.string().min(100).max(8_000_000),
  /** Printed in the corner stamp next to the watermark, e.g. the configuration name. */
  label: z.string().trim().max(80).optional(),
});
export const watermarkedImageSchema = z.object({ contentType: z.literal('image/png'), dataBase64: z.string() });
