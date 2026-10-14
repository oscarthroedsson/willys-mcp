import {
  HEMKOP,
  PRODUCT_CODE_HINT,
  PRODUCT_CODE_PATTERN,
  WILLYS,
  type AxfoodSite,
} from "../constants/index.js";
import type { Result } from "../core/result.js";
import * as axfood from "../upstream/axfood/index.js";
import { storeCookies } from "../upstream/axfood/store-session.js";
import type { AdapterCtx, Capability, ChainAdapter } from "./types.js";

/**
 * One adapter for the Axfood platform, instantiated per site.
 *
 * Willys has the full surface including login, cart and orders. Hemköp gets
 * the public surface: its cart and login are the same Hybris routes, but they
 * have not been verified with a real account yet (epic 6), so the capability
 * is not claimed until it is.
 */
export function createAxfoodAdapter(
  site: AxfoodSite,
  extra: Capability[] = [],
): ChainAdapter {
  /**
   * The cookies a read should carry. A logged-in session is used as is — its
   * store is the user's own choice. An anonymous call with a store gets an
   * anonymous session pinned to that store, so prices are that store's.
   */
  const cookiesFor = async (ctx: AdapterCtx): Promise<Result<string>> =>
    ctx.cookies || !ctx.storeId
      ? { ok: true, data: ctx.cookies }
      : storeCookies(site, ctx.storeId);

  return {
    id: site.chain,
    displayName: site.label,
    capabilities: new Set<Capability>([
      "search",
      "suggestions",
      "product",
      "cheapest",
      "campaigns",
      "stores",
      ...extra,
    ]),
    storeScope: "optional",
    productCode: { pattern: PRODUCT_CODE_PATTERN, hint: PRODUCT_CODE_HINT },

    async search(ctx, query, page, size) {
      const c = await cookiesFor(ctx);
      return c.ok ? axfood.search(site, c.data, query, page, size) : c;
    },
    suggestions: (ctx, term) => axfood.searchSuggestions(site, ctx.cookies, term),
    async product(ctx, code) {
      const c = await cookiesFor(ctx);
      return c.ok ? axfood.getProductDetail(site, c.data, code) : c;
    },
    async candidates(ctx, q) {
      const c = await cookiesFor(ctx);
      return c.ok ? axfood.candidates(site, c.data, q) : c;
    },
    campaigns: (ctx, storeId, page, size) =>
      axfood.getCampaigns(site, ctx.cookies, storeId, page, size),
    listStores: () => axfood.listStores(site),
    storeDetail: (storeId) => axfood.storeDetail(site, storeId),
  };
}

export const willys = createAxfoodAdapter(WILLYS, ["login", "cart", "orders"]);
export const hemkop = createAxfoodAdapter(HEMKOP);
