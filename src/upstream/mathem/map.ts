import { ORIGIN } from "../../constants/index.js";
import type { Product } from "../../domain/product.js";

/**
 * Mathem product → the shared Product.
 *
 * Observed 2026-10-14:
 * - Prices are strings ("159.00"). `gross_price` is what one package costs now;
 *   during a single-item campaign it is below `discount.undiscounted_gross_price`.
 *   A multi-buy ("2 för 30 kr") leaves `gross_price` at the ordinary price,
 *   which is what we want — it needs two packages.
 * - Pack size is the last part of `name_extra`: "Polen, 340 g" → "340 g".
 *   The part before it, when present, is the country of origin.
 * - Labels arrive as human names in `client_classifiers` ("Svensk Fågel",
 *   "Kött från Sverige", "Keyhole").
 */

export interface MathemAttributes {
  id?: number;
  full_name?: string;
  brand?: string | null;
  name_extra?: string | null;
  gross_price?: string | null;
  gross_unit_price?: string | null;
  unit_price_quantity_abbreviation?: string | null;
  discount?: { is_discounted?: boolean; undiscounted_gross_price?: string | null } | null;
  availability?: { is_available?: boolean } | null;
  client_classifiers?: Array<{ name?: string }> | null;
  categories?: Array<{ name?: string; parents?: Array<{ name?: string }> }> | null;
}

const num = (v: unknown): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const CLASSIFIER_FLAG: Array<[RegExp, string]> = [
  [/^svenskt ursprung/i, "fran_sverige"],
  [/^kött från sverige/i, "svenskt_kott"],
  [/^svensk fågel/i, "svensk_fagel"],
  [/^keyhole|nyckelhål/i, "nyckelhalet"],
  [/^krav/i, "krav"],
  [/^eu organic/i, "eu_ekologisk"],
  [/^ekologisk/i, "ekologisk"],
  [/^fryst/i, "fryst"],
];

const COMPARE_UNIT: Record<string, string> = { kg: "kg", l: "l", st: "st" };

/** "Polen, 340 g" → { size: "340 g", country: "Polen" }. */
export function splitNameExtra(extra: string | null | undefined): { size: string | null; country: string | null } {
  if (!extra) return { size: null, country: null };
  // Split on ", " only: a bare comma is a decimal separator ("1,5 l").
  const parts = extra.split(/,\s+/).map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? null;
  const looksLikeSize = last !== null && /^\d/.test(last);
  return {
    size: looksLikeSize ? last : null,
    country: parts.length > 1 ? (parts[0] ?? null) : looksLikeSize ? null : last,
  };
}

export function toMathemProduct(a: MathemAttributes): Product | null {
  if (a.id === undefined || !a.full_name) return null;

  const price = num(a.gross_price);
  const listPrice = num(a.discount?.undiscounted_gross_price) ?? price;
  const perUnit = num(a.gross_unit_price);
  const compareUnit = COMPARE_UNIT[(a.unit_price_quantity_abbreviation ?? "").toLowerCase()] ?? null;
  const { size, country } = splitNameExtra(a.name_extra);
  const names = (a.client_classifiers ?? []).map((c) => c.name ?? "");
  const flags = [
    ...new Set(
      names.flatMap((n) => CLASSIFIER_FLAG.filter(([re]) => re.test(n)).map(([, f]) => f)),
    ),
  ];

  const top = a.categories?.[0];
  return {
    code: String(a.id),
    name: a.full_name,
    brand: a.brand ?? null,
    price,
    packagePrice: price,
    unit: size,
    compare: perUnit !== null && compareUnit ? `${perUnit} kr/${compareUnit}` : null,
    compareUnit,
    perUnit,
    // An explicit "Sverige, 500 g" or the Svenskt Ursprung classifier is
    // proof; anything else is unknown, never assumed.
    origin:
      country?.toLowerCase() === "sverige" || flags.includes("fran_sverige")
        ? ORIGIN.swedish
        : ORIGIN.unknown,
    swedishMeat: flags.includes("svenskt_kott") || flags.includes("svensk_fagel"),
    flags,
    onSale: a.discount?.is_discounted === true,
    saving:
      price !== null && listPrice !== null && listPrice > price
        ? Number((listPrice - price).toFixed(2))
        : null,
    buyable: a.availability?.is_available !== false,
    category: top ? (top.parents?.[0]?.name ?? top.name ?? null) : null,
  };
}
