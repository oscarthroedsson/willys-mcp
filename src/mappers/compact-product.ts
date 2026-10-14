import type { Product } from "../domain/product.js";

/**
 * The few fields a price comparison needs, for answers that list several
 * chains at once. A full pruned product is ~140 characters; across five chains
 * with two products each that alone would pass the 2 KB budget.
 */
export function compactProduct(p: Product & { perUnitSource?: string }): Record<string, unknown> {
  return {
    kod: p.code,
    namn: p.name,
    ...(p.brand ? { marke: p.brand } : {}),
    pris: p.packagePrice ?? p.price,
    ...(p.perUnit !== null && p.compareUnit ? { jamforpris: `${p.perUnit} kr/${p.compareUnit}` } : {}),
    ...(p.unit ? { forp: p.unit } : {}),
    ...(p.onSale ? { erbjudande: true } : {}),
    ...(p.origin === "SE" ? { svensk: true } : {}),
    ...(p.perUnitSource === "beraknat" ? { jamforpris_beraknat: true } : {}),
  };
}
