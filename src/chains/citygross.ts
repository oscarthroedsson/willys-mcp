import * as cg from "../upstream/citygross/index.js";
import type { Capability, ChainAdapter } from "./types.js";

/**
 * City Gross adapter: public read surface. No key and no session; a store
 * narrows the assortment but a national default answers without one.
 */
export const citygrossAdapter: ChainAdapter = {
  id: "citygross",
  displayName: "City Gross",
  capabilities: new Set<Capability>([
    "search",
    "suggestions",
    "product",
    "cheapest",
    "campaigns",
    "stores",
  ]),
  storeScope: "optional",
  productCode: {
    pattern: /^\d+_[A-Z]{2}$/,
    hint: "City Gross produktkod har formen 101408266_KG",
  },

  search: (ctx, query, page, size) => cg.search(ctx.storeId, query, page, size),
  suggestions: (_ctx, term) => cg.suggestions(term),
  product: (ctx, code) => cg.getProduct(ctx.storeId, code),
  candidates: (ctx, q) => cg.candidates(ctx.storeId, q),
  campaigns: (_ctx, storeId, page, size) => cg.offers(storeId, page, size),
  listStores: () => cg.listStores(),
};
