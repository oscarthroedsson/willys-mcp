import {
  LABEL_TO_FLAG,
  ORIGIN,
  SWEDISH_MEAT_LABELS,
  SWEDISH_ORIGIN_LABELS,
} from "../constants/index.js";
import type { UpstreamProductT } from "../upstream/axfood/schemas.js";
import { parseVolume, unitPrice } from "./volume.js";

/** "SE" only on explicit Swedish marking; absence proves nothing. */
export type Origin = (typeof ORIGIN)[keyof typeof ORIGIN];

export interface Product {
  code: string;
  name: string;
  /** Needed to honour brand exclusions ("no budget brands on meat"). */
  brand: string | null;
  /** Raw priceValue as Willys states it — kr/kg for loose goods, else per package. */
  price: number | null;
  /**
   * Actual cost of ONE package/piece, in kronor.
   *
   * For loose _KG goods `price` is kr/kg, not what you pay — a "ca: 200g"
   * paprika at 39.90 kr/kg costs ~8 kr, not 39.90. This resolves that: it is
   * `price` converted through the pack weight when Willys prices per kg/l, and
   * equal to `price` when Willys already prices per package. Money maths must
   * use this, never `price`.
   */
  packagePrice: number | null;
  unit: string | null;
  compare: string | null;
  /** kg | l | st — the basis Willys used for `compare`. */
  compareUnit: string | null;
  /** Comparable price as a number, for ranking. */
  perUnit: number | null;
  origin: Origin;
  /** Stricter than origin: meat raised and slaughtered in Sweden. */
  swedishMeat: boolean;
  flags: string[];
  onSale: boolean;
  saving: number | null;
  buyable: boolean;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  // Swedish formatting: "1 234,50 kr" -> 1234.50
  const cleaned = v.replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  const normalised =
    cleaned.includes(",") && !cleaned.includes(".")
      ? cleaned.replace(",", ".")
      : cleaned.replace(/,/g, "");
  const n = Number.parseFloat(normalised);
  return Number.isNaN(n) ? null : n;
}

/**
 * The real cost of one package, resolving the kr/kg-vs-per-package ambiguity.
 *
 * When Willys prices per kilo or litre (loose goods, `priceUnit` "kr/kg"/"kr/l"
 * or a "kg"/"l" compare unit), `priceValue` is that per-unit figure, so the
 * package cost is it multiplied by the pack size. Otherwise `priceValue` is
 * already the package price. "ca:" packs make this an estimate — which is
 * honest: loose goods are weighed at the till.
 */
function packageCost(
  priceValue: number | null,
  priceUnit: string | null,
  compareUnit: string | null,
  pack: ReturnType<typeof parseVolume>,
): number | null {
  if (priceValue === null) return null;

  const pricedByWeight =
    priceUnit === "kr/kg" ||
    priceUnit === "kr/l" ||
    (priceUnit == null && (compareUnit === "kg" || compareUnit === "l"));

  // Per-package pricing, or no pack size to convert with: take priceValue as-is.
  if (!pricedByWeight || !pack || pack.measure === "count" || pack.amount <= 0) {
    return priceValue;
  }

  // pack.amount is grams or millilitres; priceValue is per kg or per litre.
  return Number(((priceValue * pack.amount) / 1000).toFixed(2));
}

export function toProduct(raw: UpstreamProductT): Product {
  const labels = raw.labels ?? [];
  const saving = toNumber(raw.savingsAmount);
  const priceValue = raw.priceValue ?? toNumber(raw.price);
  const pack = parseVolume(raw.displayVolume);

  return {
    code: raw.code,
    name: raw.name,
    brand: raw.manufacturer ?? null,
    price: priceValue,
    packagePrice: packageCost(
      priceValue,
      raw.priceUnit ?? null,
      raw.comparePriceUnit ?? null,
      pack,
    ),
    unit: raw.displayVolume ?? null,
    compare: raw.comparePrice ?? null,
    compareUnit: raw.comparePriceUnit ?? null,
    // Willys' own comparison price is authoritative: it accounts for deposits
    // and campaign pricing we cannot see. Only fall back to dividing price by
    // pack size when they omit it.
    perUnit:
      toNumber(raw.comparePrice) ??
      unitPrice(
        raw.priceValue ?? toNumber(raw.price),
        parseVolume(raw.displayVolume),
      )?.value ??
      null,
    // Brand and product name are NEVER treated as proof of origin. Guldfågeln
    // is Swedish but often unlabelled; inferring from it would be inventing a
    // fact the API did not state.
    origin: labels.some((l) => SWEDISH_ORIGIN_LABELS.includes(l))
      ? ORIGIN.swedish
      : ORIGIN.unknown,
    swedishMeat: labels.some((l) => SWEDISH_MEAT_LABELS.includes(l)),
    flags: labels.map((l) => LABEL_TO_FLAG[l]).filter((x): x is string => Boolean(x)),
    onSale:
      (raw.potentialPromotions?.length ?? 0) > 0 ||
      raw.bargainProduct === true ||
      (saving !== null && saving > 0),
    saving,
    buyable: raw.outOfStock !== true && raw.addToCartDisabled !== true,
  };
}
