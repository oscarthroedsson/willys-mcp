import { axfoodEndpoints, SORT, type AxfoodSite } from "../../constants/index.js";
import { request } from "../../core/http.js";
import { err, ok, type Result } from "../../core/result.js";
import { toProduct } from "../../domain/product.js";
import type { CandidateQuery, CandidateSet, CategoryOption } from "../../chains/types.js";
import { UpstreamSearch } from "./schemas.js";

/**
 * Candidates for "cheapest" — one request, filtered and sorted upstream.
 *
 * Axfood runs SAP Hybris, whose Solr layer encodes facet filters inside the
 * `q` parameter as `text:facetKey:facetValue`. The search response hands us
 * the exact strings to use, so none of this is guessed:
 *
 *   q=köttfärs               -> 37 hits, cheapest is a Findus sauce
 *   q=köttfärs:category:Kött -> 29 hits, cheapest is actual mince
 *
 * Sorting with `compareprice:asc` means the 100 we fetch are the 100 cheapest
 * per kg/l/st across the ENTIRE result set — not a relevance page we then sort.
 * `price:asc` is a trap worth naming: it puts a 16 kr toddler meal (75 kr/kg)
 * above a 69 kr kilo of mince. Two earlier designs are gone: paging and
 * sorting in memory, and browsing /c/{slug} (which ignores `sort` outright).
 */

/** Axfood caps page size at 100 regardless of what is requested. */
const PAGE_SIZE = 100;

interface RawFacet {
  code?: string;
  name?: string;
  values?: Array<{ code?: string; name?: string; count?: number }>;
}

function readCategoryFacets(payload: unknown): CategoryOption[] {
  const facets = (payload as { facets?: RawFacet[] })?.facets;
  if (!Array.isArray(facets)) return [];

  const cat = facets.find((f) => (f.code ?? f.name) === "category");
  return (cat?.values ?? [])
    .map((v) => ({ name: String(v.code ?? v.name ?? ""), count: v.count ?? 0 }))
    .filter((v) => v.name)
    .sort((a, b) => b.count - a.count);
}

export async function candidates(
  site: AxfoodSite,
  cookies: string,
  q: CandidateQuery,
): Promise<Result<CandidateSet>> {
  // Hybris puts facet filters in `q`; sorting stays a separate parameter.
  const query = q.category ? `${q.query}:category:${q.category}` : q.query;

  const url =
    `${axfoodEndpoints(site).search}?q=${encodeURIComponent(query)}` +
    `&page=0&size=${PAGE_SIZE}&sort=${SORT.comparePriceAsc}`;

  const res = await request(url, { cookies, label: site.label });
  if (!res.ok) return res;

  const parsed = UpstreamSearch.safeParse(res.data);
  if (!parsed.success) return err("SHAPE", "Oväntat format på sökresultatet");

  const rows = parsed.data.results ?? [];
  const categories = readCategoryFacets(res.data);

  // Hemköp often returns no `category` facet at all, and then the
  // `:category:X` suffix is silently ignored — the hits are unfiltered. Claim a
  // category as applied only when the response shows it was.
  const applied =
    q.category && categories.some((c) => c.name === q.category) ? q.category : null;

  return ok({
    totalHits: parsed.data.pagination?.totalNumberOfResults ?? rows.length,
    products: rows.map(toProduct),
    categories,
    appliedCategory: applied,
  });
}
