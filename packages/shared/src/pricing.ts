import { z } from 'zod';
import { basisPoints, currencyCode, minorUnits, uuid } from './common.ts';

// ---- Prices: the shop owner edits the base price and the largest discount of each sauna ----------
// (Prices of single options are set per sauna under "Saunas > Options".)

export const pricedSaunaSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** Base price in the shop's currency, minor units (cents/Rappen), as shown to customers. */
  listPriceMinor: minorUnits.nullable(),
  /** Largest discount the shop may give on this sauna, in basis points (100 = 1 %). */
  maxDiscountBps: basisPoints.nullable(),
});
export type PricedSauna = z.infer<typeof pricedSaunaSchema>;

export const pricingSchema = z.object({ currency: currencyCode, items: z.array(pricedSaunaSchema) });
export type Pricing = z.infer<typeof pricingSchema>;

export const putPriceRequest = z.object({ listPriceMinor: minorUnits, maxDiscountBps: basisPoints });
