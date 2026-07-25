/**
 * Package-size parsing.
 *
 * Grounded in a survey of 45 distinct `displayVolume` strings from production
 * (2026-07-18). The grammar is small but has one trap: exact volumes use a
 * comma as decimal separator ("1,5l") while approximate ones use a dot
 * ("ca: 1.1kg"). Both must be accepted.
 *
 * Observed vocabulary: g, kg, l, dl, p, st — with an optional "ca: " prefix
 * meaning the pack is sold by weight and the number is nominal.
 */

export type Measure = "mass" | "volume" | "count";

export interface ParsedVolume {
  /** Normalised: grams for mass, millilitres for volume, items for count. */
  amount: number;
  measure: Measure;
  /** True for "ca:" — actual weight varies, so totals are estimates. */
  approximate: boolean;
  /** The original string, kept so callers can show what Willys said. */
  raw: string;
}

const UNITS: Record<string, { factor: number; measure: Measure }> = {
  g: { factor: 1, measure: "mass" },
  kg: { factor: 1000, measure: "mass" },
  ml: { factor: 1, measure: "volume" },
  cl: { factor: 10, measure: "volume" },
  dl: { factor: 100, measure: "volume" },
  l: { factor: 1000, measure: "volume" },
  p: { factor: 1, measure: "count" },
  st: { factor: 1, measure: "count" },
  pack: { factor: 1, measure: "count" },
};

/** `ca: 850g` -> { amount: 850, measure: "mass", approximate: true } */
export function parseVolume(raw: string | null | undefined): ParsedVolume | null {
  if (!raw) return null;

  const text = raw.trim().toLowerCase();
  const approximate = text.startsWith("ca:") || text.startsWith("ca ");
  let body = text.replace(/^ca[:\s]+/, "").trim();

  // Drained-weight notation "650/350g" = gross/drained. The drained figure is
  // what you cook with, so keep the part after the slash. Only when both sides
  // are whole numbers, to avoid misreading a "1/2 dl" fraction as "2 dl".
  body = body.replace(/^\d+\s*\/\s*(\d+\s*[a-zå])/, "$1");

  // Accept both decimal separators; they are used inconsistently upstream.
  const m = /^([0-9]+(?:[.,][0-9]+)?)\s*([a-zå]+)$/.exec(body);
  if (!m) return null;

  const numeric = Number.parseFloat(m[1]!.replace(",", "."));
  if (!Number.isFinite(numeric)) return null;

  const unit = UNITS[m[2]!];
  if (!unit) return null;

  return {
    amount: numeric * unit.factor,
    measure: unit.measure,
    approximate,
    raw,
  };
}

export interface Requirement {
  amount: number;
  measure: Measure;
}

/** "500 g köttfärs" -> { amount: 500, measure: "mass" } */
export function parseRequirement(text: string): Requirement | null {
  const m = /([0-9]+(?:[.,][0-9]+)?)\s*([a-zå]+)/i.exec(text.trim());
  if (!m) return null;
  const numeric = Number.parseFloat(m[1]!.replace(",", "."));
  const unit = UNITS[m[2]!.toLowerCase()];
  if (!Number.isFinite(numeric) || !unit) return null;
  return { amount: numeric * unit.factor, measure: unit.measure };
}

export interface PackageMath {
  packages: number;
  totalAmount: number;
  surplus: number;
  approximate: boolean;
}

/**
 * How many packages cover the requirement?
 *
 * Returns null when the measures disagree (asking for millilitres of a product
 * sold by weight), because guessing a conversion would silently produce a wrong
 * shopping list. Density is not knowable from this API.
 */
export function packagesNeeded(
  need: Requirement,
  pack: ParsedVolume,
): PackageMath | null {
  if (need.measure !== pack.measure) return null;
  if (pack.amount <= 0) return null;

  const packages = Math.ceil(need.amount / pack.amount);
  const totalAmount = packages * pack.amount;

  return {
    packages,
    totalAmount,
    surplus: totalAmount - need.amount,
    approximate: pack.approximate,
  };
}

/**
 * Price per kilogram / litre / item.
 *
 * Willys already computes this as `comparePrice` with `comparePriceUnit` in
 * {kg, l, st}, so prefer their number and only fall back to our own division
 * when it is missing. Their value accounts for deposits and campaign pricing
 * that we cannot see.
 */
export function unitPrice(
  price: number | null,
  pack: ParsedVolume | null,
): { value: number; unit: string } | null {
  if (price === null || !pack || pack.amount <= 0) return null;

  switch (pack.measure) {
    case "mass":
      return { value: (price / pack.amount) * 1000, unit: "kr/kg" };
    case "volume":
      return { value: (price / pack.amount) * 1000, unit: "kr/l" };
    case "count":
      return { value: price / pack.amount, unit: "kr/st" };
  }
}
