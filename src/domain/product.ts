import {
  LABEL_TO_FLAG,
  ORIGIN,
  SWEDISH_MEAT_LABELS,
  SWEDISH_ORIGIN_LABELS,
} from "../constants/index.js";
import type { UpstreamProductT } from "../upstream/schemas.js";
import { parseVolume, unitPrice } from "./volume.js";

/** "SE" only on explicit Swedish marking; absence proves nothing. */
export type Origin = (typeof ORIGIN)[keyof typeof ORIGIN];

export interface Product {
  code: string;
  name: string;
  /** Needed to honour brand exclusions ("no budget brands on meat"). */
  brand: string | null;
  price: number | null;
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

export function toProduct(raw: UpstreamProductT): Product {
  const labels = raw.labels ?? [];
  const saving = toNumber(raw.savingsAmount);

  return {
    code: raw.code,
    name: raw.name,
    brand: raw.manufacturer ?? null,
    price: raw.priceValue ?? toNumber(raw.price),
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
