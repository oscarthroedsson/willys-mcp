import { err, type Result } from "../core/result.js";
import * as coop from "../upstream/coop/index.js";
import type { AdapterCtx, Capability, ChainAdapter } from "./types.js";

/**
 * Coop adapter: public read surface only (no login or cart yet — epic 6).
 *
 * storeScope is "required": Coop has no national assortment, only e-commerce
 * stores have one, and prices differ between them (mellanmjölk 10,95 kr in
 * Uppsala, 15,95 kr in Göteborg on 2026-10-13). The server never picks a store
 * for the user, so a call without one is refused with directions instead of
 * quietly using some default.
 */

function requireStore(ctx: AdapterCtx): Result<string> {
  if (ctx.storeId) return { ok: true, data: ctx.storeId };
  return err(
    "INPUT",
    "Coop kräver en e-handelsbutik: priser och sortiment skiljer sig mellan butiker. " +
      "Fråga användaren efter postnummer och slå upp butiken, eller ange storeId " +
      "(6-siffrigt, t.ex. 251300).",
  );
}

export const coopAdapter: ChainAdapter = {
  id: "coop",
  displayName: "Coop",
  capabilities: new Set<Capability>([
    "search",
    "suggestions",
    "product",
    "cheapest",
    "campaigns",
    "stores",
  ]),
  storeScope: "required",
  registryIncomplete: true,
  productCode: { pattern: /^\d{8,14}$/, hint: "Coops produktkod är EAN, 8–14 siffror, t.ex. 7300156581006" },

  async search(ctx, query, page, size) {
    const s = requireStore(ctx);
    return s.ok ? coop.search(s.data, query, page, size) : s;
  },
  async suggestions(ctx, term) {
    const s = requireStore(ctx);
    return s.ok ? coop.suggestions(s.data, term) : s;
  },
  async product(ctx, code) {
    const s = requireStore(ctx);
    return s.ok ? coop.getProduct(s.data, code) : s;
  },
  async candidates(ctx, q) {
    const s = requireStore(ctx);
    return s.ok ? coop.candidates(s.data, q) : s;
  },
  campaigns: (_ctx, storeId, page, size) => coop.promotions(storeId, page, size),
  listStores: () => coop.listStores(),
  storeDetail: (storeId) => coop.storeDetail(storeId),
  storeForPostcode: (postcode) => coop.storeForPostcode(postcode),
};
