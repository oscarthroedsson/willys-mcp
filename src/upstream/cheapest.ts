import { ENDPOINTS, SORT } from "../constants/index.js";
import { request } from "../core/http.js";
import { err, ok, type Result } from "../core/result.js";
import { toProduct, type Product } from "../domain/product.js";
import {
  packagesNeeded,
  parseRequirement,
  parseVolume,
  type PackageMath,
} from "../domain/volume.js";
import { UpstreamSearch } from "./schemas.js";

/**
 * Ranked product lookup — one request, filtered and sorted upstream.
 *
 * Willys runs SAP Hybris, whose Solr layer encodes facet filters inside the
 * `q` parameter as `text:facetKey:facetValue`. The search response hands us
 * the exact strings to use, so none of this is guessed:
 *
 *   q=köttfärs               -> 37 hits, cheapest is a Findus sauce
 *   q=köttfärs:category:Kött -> 29 hits, cheapest is actual mince
 *
 * Combined with `sort=compareprice:asc` this ranks by price per kg/l/st across
 * the ENTIRE result set. Two earlier designs are gone: paging and sorting in
 * memory (which read a subset and called it "cheapest"), and browsing
 * /c/{slug} (which ignores `sort` outright and caps pages at 100).
 *
 * Sorting by `price:asc` is a trap worth naming: it puts a 16 kr toddler meal
 * (75 kr/kg) above a 69 kr kilo of mince.
 */

export interface CheapestOptions {
  query: string;
  /**
   * Facet value from `availableCategories`, e.g. "Kött" or "Fågel". Applied
   * server-side. Deliberately a free string rather than an enum: facets are
   * per-query and returned by the API, so a hardcoded list would go stale.
   */
  category?: string | undefined;
  onlySwedish: boolean;
  /** Require the stricter meat_from_sweden / swedish_bird labels. */
  requireSwedishMeat: boolean;
  excludeBrands: string[];
  onlyBuyable: boolean;
  /**
   * Require the product name to contain these words (case-insensitive).
   *
   * Cheapest-first over free text produces confident nonsense: "torkad dragon"
   * matched a dried pig ear sold as a dog chew, because it was the cheapest
   * thing containing "torkad". A name check is crude but catches the class of
   * error where the match shares a word and nothing else.
   */
  mustContain?: string[] | undefined;
  /** Requirement text such as "1.7 kg" — enables package maths. */
  need?: string | undefined;
  limit: number;
}

export interface RankedProduct extends Product {
  packaging: PackageMath | null;
  /** What covering `need` with this product actually costs. */
  estimatedCost: number | null;
}

export interface CategoryOption {
  name: string;
  count: number;
}

export interface CheapestResult {
  totalHits: number;
  inspected: number;
  /** Categories available for THIS query, so the caller can narrow further. */
  availableCategories: CategoryOption[];
  appliedCategory: string | null;
  filteredOut: {
    notSwedish: number;
    notSwedishMeat: number;
    excludedBrand: number;
    notBuyable: number;
    noPrice: number;
    irrelevantName: number;
  };
  products: RankedProduct[];
  /** Set when the cheapest per-unit option is not the cheapest way to cover `need`. */
  note?: string;
}

/** Willys caps page size at 100 regardless of what is requested. */
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

export async function findCheapest(
  cookies: string,
  opts: CheapestOptions,
): Promise<Result<CheapestResult>> {
  // Hybris puts facet filters in `q`; sorting stays a separate parameter.
  const q = opts.category
    ? `${opts.query}:category:${opts.category}`
    : opts.query;

  const url =
    `${ENDPOINTS.search}?q=${encodeURIComponent(q)}` +
    `&page=0&size=${PAGE_SIZE}&sort=${SORT.comparePriceAsc}`;

  const res = await request(url, { cookies });
  if (!res.ok) return res;

  const parsed = UpstreamSearch.safeParse(res.data);
  if (!parsed.success) return err("SHAPE", "Oväntat format på sökresultatet");

  const rows = parsed.data.results ?? [];
  const banned = opts.excludeBrands
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);

  const filteredOut = {
    notSwedish: 0,
    notSwedishMeat: 0,
    excludedBrand: 0,
    notBuyable: 0,
    noPrice: 0,
    irrelevantName: 0,
  };

  const required = (opts.mustContain ?? []).map((w) => w.toLowerCase());

  const kept: Product[] = [];
  for (const raw of rows) {
    const p = toProduct(raw);

    if (opts.onlyBuyable && !p.buyable) {
      filteredOut.notBuyable++;
      continue;
    }
    if (opts.requireSwedishMeat && !p.swedishMeat) {
      filteredOut.notSwedishMeat++;
      continue;
    }
    if (opts.onlySwedish && p.origin !== "SE") {
      filteredOut.notSwedish++;
      continue;
    }
    if (p.brand && banned.some((b) => p.brand!.toLowerCase().includes(b))) {
      filteredOut.excludedBrand++;
      continue;
    }
    if (p.perUnit === null && p.price === null) {
      filteredOut.noPrice++;
      continue;
    }
    if (required.length > 0) {
      const name = p.name.toLowerCase();
      if (!required.every((w) => name.includes(w))) {
        filteredOut.irrelevantName++;
        continue;
      }
    }
    kept.push(p);
  }

  const need = opts.need ? parseRequirement(opts.need) : null;

  // Upstream order is already cheapest-per-unit first; map() preserves it.
  const ranked: RankedProduct[] = kept.map((p) => {
    const pack = parseVolume(p.unit);
    const packaging = need && pack ? packagesNeeded(need, pack) : null;
    return {
      ...p,
      packaging,
      estimatedCost:
        packaging && p.price !== null
          ? Number((packaging.packages * p.price).toFixed(2))
          : null,
    };
  });

  // With a concrete requirement, re-rank on what covering it actually costs.
  // The cheapest kr/kg can force buying far more than needed, so a slightly
  // dearer product in a smaller pack can win on real money.
  let note: string | undefined;
  if (need) {
    const withCost = ranked.filter((p) => p.estimatedCost !== null);
    if (withCost.length > 0) {
      const cheapestPerUnit = ranked[0];
      withCost.sort((a, b) => a.estimatedCost! - b.estimatedCost!);
      if (cheapestPerUnit && withCost[0]?.code !== cheapestPerUnit.code) {
        note =
          "Rangordnat på total kostnad för behovet, inte på jämförpris. " +
          `Billigast per enhet (${cheapestPerUnit.name}) kräver mer förpackning än du behöver.`;
      }
      const rest = ranked.filter((p) => p.estimatedCost === null);
      ranked.length = 0;
      ranked.push(...withCost, ...rest);
    }
  }

  const result: CheapestResult = {
    totalHits: parsed.data.pagination?.totalNumberOfResults ?? rows.length,
    inspected: rows.length,
    availableCategories: readCategoryFacets(res.data),
    appliedCategory: opts.category ?? null,
    filteredOut,
    products: ranked.slice(0, opts.limit),
  };
  if (note) result.note = note;

  return ok(result);
}
