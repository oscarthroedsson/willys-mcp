import {
  GS1_SWEDISH_MEAT,
  GS1_TO_FLAG,
  ORIGIN,
} from "../../constants/index.js";
import type { Product } from "../../domain/product.js";

/**
 * Coop (Loop54) product → the shared Product.
 *
 * Observed 2026-10-14 over nötfärs, paprika and kycklingfilé:
 * - salesUnit "Styck": piecePriceData is the package price.
 * - salesUnit "Vikt": salesPriceData is kr/kg and piecePriceData the estimated
 *   price of one ~packageSize-gram piece (paprika: 59,90 kr/kg, 11,98 kr for
 *   ~200 g). Same split as Axfood's loose _KG goods, so `price` is kr/kg there
 *   and `packagePrice` the piece.
 * - comparativePriceData is kr per comparativePriceUnit (kg | liter | styck).
 * - A multi-buy ("2 för 177") is NOT the current price: it needs two packages.
 *   Only an unconditional single-item promotion lowers `price`.
 */

interface Money {
  b2cPrice?: number | null;
}

interface Promotion {
  priceData?: Money | null;
  comparativePrice?: Money | null;
  type?: string | null;
  numberOfProductRequired?: number | null;
  medMeraRequired?: boolean | null;
  message?: string | null;
}

interface NavCategory {
  name?: string;
  superCategories?: NavCategory[];
}

export interface CoopItem {
  id?: string;
  ean?: string;
  name?: string;
  manufacturerName?: string | null;
  salesUnit?: string | null;
  packageSize?: number | null;
  packageSizeUnit?: string | null;
  packageSizeInformation?: string | null;
  salesPriceData?: Money | null;
  piecePriceData?: Money | null;
  comparativePriceData?: Money | null;
  comparativePriceUnit?: { unit?: string | null; text?: string | null } | null;
  comparativePriceText?: string | null;
  onlinePromotions?: Promotion[] | null;
  accreditedTags?: Array<{ code?: string }> | null;
  fromSweden?: boolean | null;
  availableOnline?: boolean | null;
  navCategories?: NavCategory[] | null;
  listOfIngredients?: string | null;
  description?: string | null;
  nutrientInformation?: unknown[] | null;
  nutrientBasis?: unknown;
}

const COMPARE_UNIT: Record<string, string> = { kg: "kg", liter: "l", styck: "st" };

const price = (m: Money | null | undefined): number | null =>
  typeof m?.b2cPrice === "number" && Number.isFinite(m.b2cPrice) ? m.b2cPrice : null;

/** "1500 Milliliter" → "1500ml", "200 gram ungefärlig vikt" → "ca: 200g". */
function displayVolume(item: CoopItem): string | null {
  const n = item.packageSize;
  const u = (item.packageSizeUnit ?? "").toLowerCase();
  if (typeof n !== "number" || n <= 0) return item.packageSizeInformation ?? null;
  const approx = u.includes("ungefärlig") || item.salesUnit === "Vikt";
  const prefix = approx ? "ca: " : "";
  if (u.startsWith("gram")) return `${prefix}${n}g`;
  if (u.startsWith("milliliter")) return `${prefix}${n}ml`;
  if (u === "st" || u.startsWith("styck")) return `${n}st`;
  return item.packageSizeInformation ?? null;
}

/** The outermost of the first navigation path: "Kött, Fågel & Chark", "Djurmat & Tillbehör". */
export function topCategory(item: CoopItem): string | null {
  let node = item.navCategories?.[0];
  if (!node) return null;
  while (node.superCategories && node.superCategories.length > 0) {
    node = node.superCategories[0]!;
  }
  return node.name ?? null;
}

/** An unconditional single-package promotion — the only kind that is "the price". */
function plainPromotion(item: CoopItem): Promotion | null {
  return (
    (item.onlinePromotions ?? []).find(
      (p) =>
        p.medMeraRequired !== true &&
        (p.numberOfProductRequired ?? 1) <= 1 &&
        price(p.priceData) !== null,
    ) ?? null
  );
}

export function toCoopProduct(item: CoopItem): Product | null {
  const code = item.ean ?? item.id;
  if (!code || !item.name) return null;

  const weighed = item.salesUnit === "Vikt";
  const promo = plainPromotion(item);
  const tags = (item.accreditedTags ?? []).map((t) => t.code ?? "").filter(Boolean);

  const listPrice = weighed ? price(item.salesPriceData) : price(item.piecePriceData);
  const piece = price(item.piecePriceData);
  const promoPrice = promo ? price(promo.priceData) : null;
  const comparePrice = promo
    ? (price(promo.comparativePrice) ?? price(item.comparativePriceData))
    : price(item.comparativePriceData);

  // For weighed goods a promotion is stated per kg like the list price, so the
  // piece price scales with it.
  const packagePrice =
    promoPrice !== null && listPrice
      ? weighed && piece !== null
        ? Number(((piece * promoPrice) / listPrice).toFixed(2))
        : promoPrice
      : piece;

  const unitKey = (item.comparativePriceUnit?.unit ?? "").toLowerCase();
  const compareUnit = COMPARE_UNIT[unitKey] ?? null;
  const multiBuy = (item.onlinePromotions ?? []).length > 0;

  return {
    code,
    name: item.name,
    brand: item.manufacturerName ?? null,
    price: promoPrice ?? listPrice,
    packagePrice,
    unit: displayVolume(item),
    compare: comparePrice !== null && compareUnit ? `${comparePrice} kr/${compareUnit}` : null,
    compareUnit,
    perUnit: comparePrice,
    origin:
      item.fromSweden === true || tags.includes("FRAN_SVERIGE") ? ORIGIN.swedish : ORIGIN.unknown,
    swedishMeat: tags.some((t) => GS1_SWEDISH_MEAT.includes(t)),
    flags: tags.map((t) => GS1_TO_FLAG[t]).filter((x): x is string => Boolean(x)),
    onSale: multiBuy,
    saving:
      promoPrice !== null && listPrice !== null && listPrice > promoPrice
        ? Number((listPrice - promoPrice).toFixed(2))
        : null,
    buyable: item.availableOnline !== false,
    category: topCategory(item),
  };
}
