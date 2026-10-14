import * as mathem from "../upstream/mathem/index.js";
import type { Capability, ChainAdapter } from "./types.js";

/**
 * Mathem adapter: one national assortment, no stores, no key. Suggestions are
 * not offered — Mathem's autocomplete is the same mixed search, so it would
 * only duplicate `search`.
 */
export const mathemAdapter: ChainAdapter = {
  id: "mathem",
  displayName: "Mathem",
  capabilities: new Set<Capability>(["search", "product", "cheapest"]),
  storeScope: "none",
  productCode: { pattern: /^\d{1,9}$/, hint: "Mathems produkt-id är ett tal, t.ex. 67701" },

  search: (_ctx, query, page, size) => mathem.search(query, page, size),
  suggestions: async () => ({ ok: false, kind: "INPUT", message: "Mathem har inga separata sökförslag." }),
  product: (_ctx, code) => mathem.getProduct(code),
  candidates: (_ctx, q) => mathem.candidates(q),
};
