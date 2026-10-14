import { MATHEM } from "../../constants/index.js";
import { request } from "../../core/http.js";
import { err, ok, type Result } from "../../core/result.js";
import type { Product } from "../../domain/product.js";
import type { CandidateQuery, CandidateSet, ProductDetail, SearchPage } from "../../chains/types.js";
import { toMathemProduct, type MathemAttributes } from "./map.js";

/**
 * Mathem over `/api/v1`: search, candidates and product detail. One national
 * assortment, so nothing here takes a store.
 */

/** Pages fetched for "cheapest" at most: 5 × 30 covers köttfärs (43) with margin. */
const MAX_CANDIDATE_PAGES = 5;

interface MixedResponse {
  attributes?: { page?: number; has_more_items?: boolean; request_types?: Array<{ type?: string; count?: number }> };
  items?: Array<{ type?: string; attributes?: MathemAttributes }>;
}

const get = <T>(path: string) =>
  request<T>(`${MATHEM.api}${path}`, { profile: "plain", label: "Mathem" });

const productsOf = (r: MixedResponse): Product[] =>
  (r.items ?? [])
    .filter((i) => i.type === "product" && i.attributes)
    .map((i) => toMathemProduct(i.attributes!))
    .filter((p): p is Product => p !== null);

const totalOf = (r: MixedResponse) =>
  r.attributes?.request_types?.find((t) => t.type === "product")?.count ?? null;

async function page(query: string, n: number): Promise<Result<MixedResponse>> {
  return get<MixedResponse>(
    `/search/mixed/?q=${encodeURIComponent(query)}&type=product&page=${n}`,
  );
}

/**
 * Mathem's pages are fixed at 30, so `size` only trims. `page` is ours
 * (0-based) and maps onto theirs (1-based).
 */
export async function search(query: string, pageNo: number, size: number): Promise<Result<SearchPage>> {
  const res = await page(query, pageNo + 1);
  if (!res.ok) return res;
  const products = productsOf(res.data).slice(0, size);
  const total = totalOf(res.data) ?? products.length;
  return ok({
    products,
    page: pageNo,
    pages: Math.max(1, Math.ceil(total / MATHEM.pageSize)),
    total,
  });
}

/** Every product page up to the cap — Mathem cannot sort, so ranking needs all of them. */
export async function candidates(q: CandidateQuery): Promise<Result<CandidateSet>> {
  const all: Product[] = [];
  let total: number | null = null;
  for (let n = 1; n <= MAX_CANDIDATE_PAGES; n++) {
    const res = await page(q.query, n);
    if (!res.ok) {
      if (n === 1) return res;
      break; // Keep what we have rather than failing a nearly complete set.
    }
    total ??= totalOf(res.data);
    all.push(...productsOf(res.data));
    if (!res.data.attributes?.has_more_items) break;
  }
  // Search hits carry no category, so Mathem offers no category facet.
  return ok({ totalHits: total ?? all.length, products: all, categories: [], appliedCategory: null });
}

interface DetailResponse extends MathemAttributes {
  detailed_info?: {
    local?: Array<{
      description_from_supplier?: string | null;
      contents_table?: { rows?: Array<{ key?: string; value?: string }> } | null;
      nutrition_info_table?: { title?: string; rows?: Array<{ key?: string; value?: string }> } | null;
    }>;
  } | null;
}

export async function getProduct(id: string): Promise<Result<ProductDetail>> {
  const res = await get<DetailResponse>(`/products/${encodeURIComponent(id)}/`);
  if (!res.ok) {
    if (res.status === 404 || res.kind === "NOT_FOUND") {
      return err("NOT_FOUND", `Ingen produkt med id ${id} hos Mathem`, res.status);
    }
    return res;
  }
  const product = toMathemProduct(res.data);
  if (!product) return err("NOT_FOUND", `Ingen produkt med id ${id} hos Mathem`);

  const local = res.data.detailed_info?.local?.[0];
  const table = local?.nutrition_info_table;
  return ok({
    ...product,
    // Ingredients are a row in contents_table, keyed "Ingredienser" when present.
    ingredients:
      local?.contents_table?.rows?.find((r) => /^ingrediens/i.test(r.key ?? ""))?.value ?? null,
    description: local?.description_from_supplier || null,
    nutrition: table?.rows?.length ? table.rows.map((r) => ({ [r.key ?? ""]: r.value ?? null })) : null,
    // "Näringsvärde per 100g/ml" → "100g/ml"
    nutritionBasis: table?.title?.replace(/^Näringsvärde per\s*/i, "") || null,
  });
}
