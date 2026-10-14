import { axfoodEndpoints, type AxfoodSite } from "../../constants/index.js";
import { request } from "../../core/http.js";
import { err, ok, type Result } from "../../core/result.js";
import { toProduct } from "../../domain/product.js";
import type { CampaignResult } from "../../chains/types.js";
import { UpstreamSearch } from "./schemas.js";

/**
 * Store-specific campaigns — the offers surface the old `get_offers` lost.
 *
 * That tool pointed at a Next.js data route carrying a build hash and returned
 * 404. This endpoint is store-scoped (`q` is the store id, e.g. 2220 for Willys
 * or 4798 for Hemköp), returns the same envelope as search, and answered 283
 * products for Staffanstorp. A store id from the other chain answers
 * `error.store.notfound`, which arrives here as a non-200.
 */
export async function getCampaigns(
  site: AxfoodSite,
  cookies: string,
  storeId: string,
  page: number,
  size: number,
): Promise<Result<CampaignResult>> {
  const url =
    `${axfoodEndpoints(site).campaigns}?q=${encodeURIComponent(storeId)}` +
    `&type=PERSONAL_GENERAL&page=${page}&size=${size}`;

  const res = await request(url, { cookies, label: site.label });
  if (!res.ok) {
    if (res.status === 400 || res.status === 404) {
      return err(
        "NOT_FOUND",
        `Butiken ${storeId} finns inte hos ${site.label}. Slå upp ett butiks-id för rätt kedja.`,
        res.status,
      );
    }
    return res;
  }

  const parsed = UpstreamSearch.safeParse(res.data);
  if (!parsed.success) return err("SHAPE", "Oväntat format på kampanjsvaret");

  return ok({
    storeId,
    totalHits: parsed.data.pagination?.totalNumberOfResults ?? 0,
    products: (parsed.data.results ?? []).map(toProduct),
  });
}
