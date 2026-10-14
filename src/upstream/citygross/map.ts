import {
  GS1_SWEDISH_MEAT,
  GS1_SWEDISH_ORIGIN,
  GS1_TO_FLAG,
  ORIGIN,
} from "../../constants/index.js";
import type { Product } from "../../domain/product.js";

/**
 * City Gross (Loop54) product → the shared Product.
 *
 * Observed 2026-10-14:
 * - The code suffix is the sale unit, like Axfood: `_KG` is weighed and priced
 *   per kg (`currentPrice.unit` KGM), `_ST` per piece (PCE).
 * - `netContent.value` is unreliable ("5DL" arrives as 5000), so the pack size
 *   is read from `descriptiveSize` ("CA200G", "1,5L", "5DL").
 * - The current campaign is `activePromotion.priceDetails`. `currentPrice` still
 *   shows the ordinary price during a campaign (Blandfärs 123 kr/kg while on
 *   offer at 99,95), which is also why upstream comparison sorting is wrong.
 *   Only a promotion for everyone at quantity 1 is the price.
 */

interface CgPrice {
  price?: number | null;
  unit?: string | null;
  comparativePrice?: number | null;
  comparativePriceUnit?: string | null;
}

interface CgPromotion {
  membersOnly?: boolean | null;
  minQuantity?: number | null;
  priceDetails?: CgPrice | null;
}

export interface CgItem {
  id?: string;
  gtin?: string;
  name?: string;
  subtitle?: string | null;
  brand?: string | null;
  superCategory?: string | null;
  category?: string | null;
  descriptiveSize?: string | null;
  sellable?: boolean | null;
  description?: string | null;
  markings?: Array<{ code?: string | null }> | null;
  foodAndBeverageExtension?: {
    ingredientStatement?: string | null;
    nutrientInformations?: unknown[] | null;
  } | null;
  productStoreDetails?: {
    p_has_price?: boolean;
    prices?: {
      currentPrice?: CgPrice | null;
      ordinaryPrice?: CgPrice | null;
      activePromotion?: CgPromotion | null;
    } | null;
  } | null;
}

const UNIT: Record<string, string> = { KGM: "kg", LTR: "l", PCE: "st" };

/** "CA200G" → "ca: 200g", "1,5L" → "1,5l", "5DL" → "5dl". */
export function displayVolume(size: string | null | undefined): string | null {
  if (!size) return null;
  const s = size.trim().toLowerCase();
  return s.startsWith("ca") ? `ca: ${s.slice(2).trim()}` : s;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function toCgProduct(item: CgItem): Product | null {
  if (!item.id || !item.name) return null;

  const prices = item.productStoreDetails?.prices ?? {};
  const current = prices.currentPrice ?? prices.ordinaryPrice ?? null;
  const promo = prices.activePromotion;
  const plain =
    promo && promo.membersOnly !== true && (promo.minQuantity ?? 1) <= 1
      ? promo.priceDetails ?? null
      : null;

  const listPrice = num(current?.price);
  const promoPrice = num(plain?.price);
  const effective = promoPrice ?? listPrice;
  const compare = num(plain?.comparativePrice) ?? num(current?.comparativePrice);
  const compareUnit = UNIT[current?.comparativePriceUnit ?? ""] ?? null;

  const unit = displayVolume(item.descriptiveSize);
  const weighed = item.id.endsWith("_KG") || current?.unit === "KGM";
  const grams = /(\d+(?:[.,]\d+)?)\s*(kg|g)$/.exec(unit ?? "");
  const packGrams = grams
    ? Number.parseFloat(grams[1]!.replace(",", ".")) * (grams[2] === "kg" ? 1000 : 1)
    : null;

  const codes = (item.markings ?? []).map((m) => m.code ?? "").filter(Boolean);

  return {
    code: item.id,
    name: item.name,
    brand: item.brand ?? null,
    price: effective,
    packagePrice:
      weighed && effective !== null && packGrams
        ? Number(((effective * packGrams) / 1000).toFixed(2))
        : effective,
    unit,
    compare: compare !== null && compareUnit ? `${compare} kr/${compareUnit}` : null,
    compareUnit,
    perUnit: compare,
    origin: codes.some((c) => GS1_SWEDISH_ORIGIN.includes(c)) ? ORIGIN.swedish : ORIGIN.unknown,
    swedishMeat: codes.some((c) => GS1_SWEDISH_MEAT.includes(c)),
    flags: codes.map((c) => GS1_TO_FLAG[c]).filter((x): x is string => Boolean(x)),
    onSale: Boolean(promo),
    saving:
      promoPrice !== null && listPrice !== null && listPrice > promoPrice
        ? Number((listPrice - promoPrice).toFixed(2))
        : null,
    buyable: item.sellable !== false && item.productStoreDetails?.p_has_price !== false,
    category: item.superCategory ?? null,
  };
}
