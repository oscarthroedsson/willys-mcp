import { ENDPOINTS } from "../constants/index.js";
import { request } from "../core/http.js";
import { ok, type Result } from "../core/result.js";
import { toProduct, type Product } from "../domain/product.js";
import { parse } from "./parse.js";
import { UpstreamSearch } from "./schemas.js";

export interface SearchPage {
  products: Product[];
  page: number;
  pages: number;
  total: number;
}

/**
 * Free-text product search.
 *
 * Ranking here is Willys' own relevance order. For "cheapest" use
 * `findCheapest` in `cheapest.ts` — sorting this result in memory only ranks
 * the page that happened to be fetched.
 */
export async function search(
  cookies: string,
  query: string,
  page = 0,
  size = 30,
): Promise<Result<SearchPage>> {
  const url = `${ENDPOINTS.search}?q=${encodeURIComponent(query)}&page=${page}&size=${size}`;
  const res = await request(url, { cookies });
  if (!res.ok) return res;

  const parsed = parse(UpstreamSearch, res.data);
  if (!parsed.ok) return parsed;

  const p = parsed.data.pagination;
  return ok({
    products: (parsed.data.results ?? []).map(toProduct),
    page: p?.currentPage ?? page,
    pages: p?.numberOfPages ?? 1,
    total: p?.totalNumberOfResults ?? 0,
  });
}

/** Autocomplete terms for a partial query. */
export async function searchSuggestions(
  cookies: string,
  term: string,
): Promise<Result<string[]>> {
  const url = `${ENDPOINTS.autocomplete}?term=${encodeURIComponent(term)}`;
  const res = await request<{ suggestions?: Array<{ term?: string }> }>(url, {
    cookies,
  });
  if (!res.ok) return res;

  const terms = (res.data.suggestions ?? [])
    .map((s) => s.term)
    .filter((t): t is string => Boolean(t));
  return ok(terms);
}
