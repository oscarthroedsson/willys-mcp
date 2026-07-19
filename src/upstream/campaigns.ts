import { ENDPOINTS } from "../constants/index.js";
import { request } from "../core/http.js";
import { err, ok, type Result } from "../core/result.js";
import { toProduct, type Product } from "../domain/product.js";
import { UpstreamSearch } from "./schemas.js";

export interface CampaignResult {
  storeId: string;
  totalHits: number;
  products: Product[];
}

/**
 * Store-specific campaigns — the offers surface the old `get_offers` lost.
 *
 * That tool pointed at a Next.js data route carrying a build hash and returned
 * 404. This endpoint is store-scoped (`q` is the store id, e.g. 2220), returns
 * the same envelope as search, and answered 283 products for Staffanstorp.
 */
export async function getCampaigns(
  cookies: string,
  storeId: string,
  page: number,
  size: number,
): Promise<Result<CampaignResult>> {
  const url =
    `${ENDPOINTS.campaigns}?q=${encodeURIComponent(storeId)}` +
    `&type=PERSONAL_GENERAL&page=${page}&size=${size}`;

  const res = await request(url, { cookies });
  if (!res.ok) return res;

  const parsed = UpstreamSearch.safeParse(res.data);
  if (!parsed.success) return err("SHAPE", "Oväntat format på kampanjsvaret");

  return ok({
    storeId,
    totalHits: parsed.data.pagination?.totalNumberOfResults ?? 0,
    products: (parsed.data.results ?? []).map(toProduct),
  });
}
