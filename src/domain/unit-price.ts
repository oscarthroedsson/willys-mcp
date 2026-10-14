import { log } from "../core/logger.js";
import type { Product } from "./product.js";
import { parseVolume } from "./volume.js";

/**
 * A comparison price the server can stand behind.
 *
 * Upstream comparison prices are usually right — Axfood's account for deposits
 * and campaigns we cannot see — but not always: Coop listed "Nötfärs 12%" at
 * 199 kr with 0,20 kr/kg, which would have ranked it the cheapest mince in the
 * country. When the package size is known we compute price ÷ amount ourselves
 * and only trust upstream when the two roughly agree.
 */

/** Disagreement beyond this factor means the upstream figure is wrong. */
const MAX_FACTOR = 3;

export type UnitPriceSource = "uppstroms" | "beraknat" | "okontrollerat";

/** What price ÷ amount gives, in the product's own compare unit, if computable. */
export function computedUnitPrice(p: Pick<Product, "packagePrice" | "unit" | "compareUnit">): number | null {
  const pack = parseVolume(p.unit);
  if (!pack || p.packagePrice === null || pack.amount <= 0) return null;
  const per =
    p.compareUnit === "kg" && pack.measure === "mass"
      ? p.packagePrice / (pack.amount / 1000)
      : p.compareUnit === "l" && pack.measure === "volume"
        ? p.packagePrice / (pack.amount / 1000)
        : p.compareUnit === "st" && pack.measure === "count"
          ? p.packagePrice / pack.amount
          : null;
  return per !== null && Number.isFinite(per) ? Number(per.toFixed(2)) : null;
}

/** The product with a vetted `perUnit` and where it came from. */
export function vetUnitPrice<T extends Product>(p: T): T & { perUnitSource: UnitPriceSource } {
  const own = computedUnitPrice(p);
  if (own === null) {
    return { ...p, perUnitSource: "okontrollerat" };
  }
  if (p.perUnit === null) return { ...p, perUnit: own, perUnitSource: "beraknat" };

  const ratio = p.perUnit > 0 ? own / p.perUnit : Infinity;
  if (ratio > MAX_FACTOR || ratio < 1 / MAX_FACTOR) {
    log.warn("uppströms jämförpris avviker, använder beräknat", {
      code: p.code,
      name: p.name,
      uppstroms: p.perUnit,
      beraknat: own,
    });
    return { ...p, perUnit: own, compare: `${own} kr/${p.compareUnit}`, perUnitSource: "beraknat" };
  }
  return { ...p, perUnitSource: "uppstroms" };
}
