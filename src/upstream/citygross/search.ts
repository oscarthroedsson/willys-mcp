import { CITYGROSS } from "../../constants/index.js";
import { err, ok, type Result } from "../../core/result.js";
import type { Product } from "../../domain/product.js";
import type {
  CampaignResult,
  CandidateQuery,
  CandidateSet,
  CategoryOption,
  ProductDetail,
  SearchPage,
} from "../../chains/types.js";
import { cgGet, storeParam } from "./http.js";
import { toCgProduct, type CgItem } from "./map.js";

/**
 * City Gross search, autocomplete, product and offers over `/api/v1/Loop54`.
 *
 * `store` (a storeNumber such as 3204) narrows the assortment to that store;
 * without it the national assortment answers.
 *
 * Trap (verified 2026-10-14): `skip`/`take` and `totalCount` run over ONE mixed
 * list of products, recipes, pages and stores. "köttfärs" reports 101 hits of
 * which 9 are products and the rest recipes; take=50 returns 9 products and 40
 * recipes. So `total` here is an upper bound on products, and candidates page
 * through the whole mixed list collecting only the products.
 */

/** One page of the mixed list; 100 is accepted ("ost": 100 products in one call). */
const PAGE = 100;
/** Pages read for candidates at most — 300 mixed hits covers ordinary queries. */
const MAX_CANDIDATE_PAGES = 3;

interface SearchResponse {
  searchResults?: {
    products?: CgItem[];
    totalCount?: number;
  };
  autoCompletions?: unknown;
}

const toProducts = (items: CgItem[] | undefined): Product[] =>
  (items ?? []).map(toCgProduct).filter((p): p is Product => p !== null);

export async function search(
  storeId: string | undefined,
  query: string,
  page: number,
  size: number,
): Promise<Result<SearchPage>> {
  const res = await cgGet<SearchResponse>(
    `/Loop54/search?SearchQuery=${encodeURIComponent(query)}` +
      `&skip=${page * size}&take=${size}&${storeParam(storeId)}`,
  );
  if (!res.ok) return res;
  const sr = res.data.searchResults;
  if (!sr) return err("SHAPE", "City Gross sökssvar saknade searchResults");
  const total = sr.totalCount ?? 0;
  return ok({
    products: toProducts(sr.products),
    page,
    pages: Math.max(1, Math.ceil(total / size)),
    total,
  });
}

/**
 * Candidates for "cheapest": the whole hit list in one call, so category
 * filtering and ranking happen here on complete data. Upstream comparison
 * sorting ignores campaign prices and is not relied on.
 */
export async function candidates(
  storeId: string | undefined,
  q: CandidateQuery,
): Promise<Result<CandidateSet>> {
  const all: Product[] = [];
  let totalCount = 0;
  for (let n = 0; n < MAX_CANDIDATE_PAGES; n++) {
    const res = await cgGet<SearchResponse>(
      `/Loop54/search?SearchQuery=${encodeURIComponent(q.query)}` +
        `&skip=${n * PAGE}&take=${PAGE}&${storeParam(storeId)}`,
    );
    if (!res.ok) {
      if (n === 0) return res;
      break; // Keep a nearly complete set rather than failing it.
    }
    const sr = res.data.searchResults;
    if (!sr) return err("SHAPE", "City Gross sökssvar saknade searchResults");
    totalCount = sr.totalCount ?? 0;
    all.push(...toProducts(sr.products));
    if ((n + 1) * PAGE >= totalCount) break;
  }
  const counts = new Map<string, number>();
  for (const p of all) {
    if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  const categories: CategoryOption[] = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const applied = q.category && counts.has(q.category) ? q.category : null;
  return ok({
    // Products only: the mixed totalCount would count recipes as hits.
    totalHits: all.length,
    products: applied ? all.filter((p) => p.category === applied) : all,
    categories,
    appliedCategory: applied,
  });
}

export async function suggestions(term: string): Promise<Result<string[]>> {
  // `autoCompletions` is `{ count, items: [{ query }] }`, not a list.
  const res = await cgGet<{ autoCompletions?: { items?: Array<{ query?: string }> } }>(
    `/Loop54/search/quick/?SearchQuery=${encodeURIComponent(term)}`,
  );
  if (!res.ok) return res;
  return ok(
    (res.data.autoCompletions?.items ?? [])
      .map((a) => a.query)
      .filter((s): s is string => Boolean(s)),
  );
}

export async function getProduct(
  storeId: string | undefined,
  code: string,
): Promise<Result<ProductDetail>> {
  const res = await cgGet<{ items?: CgItem[] }>(
    `/Loop54/products/${encodeURIComponent(code)}?${storeParam(storeId)}`,
  );
  if (!res.ok) return res;
  const item = res.data.items?.[0];
  const product = item ? toCgProduct(item) : null;
  if (!item || !product) return err("NOT_FOUND", `Ingen produkt med koden ${code} hos City Gross`);

  const fbe = item.foodAndBeverageExtension ?? {};
  return ok({
    ...product,
    ingredients: fbe.ingredientStatement ?? null,
    description: item.description ?? null,
    nutrition: Array.isArray(fbe.nutrientInformations) ? fbe.nutrientInformations : null,
    nutritionBasis: null,
  });
}

/** This week's offers: the grocery root category filtered to current discounts. */
export async function offers(
  storeId: string,
  page: number,
  size: number,
): Promise<Result<CampaignResult>> {
  const res = await cgGet<{ items?: CgItem[]; totalCount?: number }>(
    `/Loop54/category/${CITYGROSS.groceryCategory}/products?currentWeekDiscountOnly=true` +
      `&discountonly=true&skip=${page * size}&take=${size}&${storeParam(storeId)}`,
  );
  if (!res.ok) return res;
  return ok({
    storeId,
    totalHits: res.data.totalCount ?? 0,
    products: toProducts(res.data.items),
  });
}
