import { COOP } from "../../constants/index.js";
import { err, ok, type Result } from "../../core/result.js";
import type { Product } from "../../domain/product.js";
import type {
  CampaignResult,
  CandidateQuery,
  CandidateSet,
  CategoryOption,
  SearchPage,
} from "../../chains/types.js";
import { coopRequest } from "./http.js";
import { toCoopProduct, type CoopItem } from "./map.js";

/**
 * Coop search via Loop54 behind `external.api.coop.se/personalization`.
 *
 * Every call is scoped to one e-commerce store (`store` = its 6-digit ledger
 * number). A physical store without e-commerce answers 0 hits rather than an
 * error (verified: 196183 Krylbo → 0), so an empty result for a non-empty
 * query is reported as "pick an e-commerce store", never as "nothing found".
 */

/** The sort the storefront itself uses for "Jämförpris lägst först". */
const SORT_COMPARE_ASC = { order: "asc", attributeName: "comparativeSortPrice", type: "attribute" };

/** Largest page we ask for — enough candidates, bounded cost. */
const CANDIDATE_TAKE = 100;

interface LoopResults {
  count?: number;
  items?: CoopItem[];
  facets?: Array<{ name?: string; items?: Array<{ item?: string; count?: number }> }>;
}

interface LoopResponse {
  results?: LoopResults;
}

const url = (path: string, store: string) =>
  `${COOP.personalization}${path}?${COOP.searchParams}&store=${encodeURIComponent(store)}`;

function products(r: LoopResults | undefined): Product[] {
  return (r?.items ?? [])
    .map(toCoopProduct)
    .filter((p): p is Product => p !== null);
}

function noAssortment(store: string): Result<never> {
  return err(
    "INPUT",
    `Coop-butiken ${store} har inget sortiment online. Bara e-handelsbutiker går att söka i — ` +
      "slå upp butiken för användarens postnummer i stället.",
  );
}

async function loop(
  store: string,
  query: string,
  skip: number,
  take: number,
  opts: { sortBy?: unknown[]; facets?: unknown[] } = {},
): Promise<Result<LoopResults>> {
  const res = await coopRequest<LoopResponse>("personalization", url("/search/products", store), {
    method: "POST",
    body: {
      query,
      resultsOptions: { skip, take, sortBy: opts.sortBy ?? [], facets: opts.facets ?? [] },
    },
  });
  if (!res.ok) return res;
  if (!res.data.results) return err("SHAPE", "Coops sökssvar saknade results");
  return ok(res.data.results);
}

export async function search(
  store: string,
  query: string,
  page: number,
  size: number,
): Promise<Result<SearchPage>> {
  const r = await loop(store, query, page * size, size);
  if (!r.ok) return r;
  const total = r.data.count ?? 0;
  if (total === 0 && page === 0 && (await storeIsEmpty(store))) return noAssortment(store);
  return ok({
    products: products(r.data),
    page,
    pages: Math.max(1, Math.ceil(total / size)),
    total,
  });
}

/**
 * Up to 100 cheapest-first candidates with the top-category facet. A category
 * is applied as a selected facet value, so it filters upstream like Axfood's
 * `:category:X`.
 */
export async function candidates(store: string, q: CandidateQuery): Promise<Result<CandidateSet>> {
  const facet = {
    attributeName: "topCategory",
    type: "distinct",
    operator: "OR",
    selected: q.category ? [q.category] : [],
  };
  const r = await loop(store, q.query, 0, CANDIDATE_TAKE, {
    sortBy: [SORT_COMPARE_ASC],
    facets: [facet],
  });
  if (!r.ok) return r;
  if ((r.data.count ?? 0) === 0 && (await storeIsEmpty(store))) return noAssortment(store);

  const categories: CategoryOption[] = (r.data.facets ?? [])
    .find((f) => f.name === "topCategory")
    ?.items?.map((i) => ({ name: i.item ?? "", count: i.count ?? 0 }))
    .filter((c) => c.name)
    .sort((a, b) => b.count - a.count) ?? [];

  return ok({
    totalHits: r.data.count ?? 0,
    products: products(r.data),
    categories,
    appliedCategory: q.category && categories.some((c) => c.name === q.category) ? q.category : null,
  });
}

/**
 * Whether the store has no online assortment at all. Asked only after an empty
 * result, with a query every grocery store matches, so a store that simply
 * lacks "saffranstrådar" is not mistaken for one without e-commerce.
 */
async function storeIsEmpty(store: string): Promise<boolean> {
  const probe = await loop(store, "mjölk", 0, 1);
  return probe.ok && (probe.data.count ?? 0) === 0;
}

export async function suggestions(store: string, term: string): Promise<Result<string[]>> {
  const res = await coopRequest<{ queries?: { items?: Array<{ query?: string }> } }>(
    "personalization",
    url("/search/auto-complete", store),
    { method: "POST", body: { query: term } },
  );
  if (!res.ok) return res;
  return ok(
    (res.data.queries?.items ?? [])
      .map((i) => i.query)
      .filter((q): q is string => Boolean(q)),
  );
}

export async function promotions(
  store: string,
  page: number,
  size: number,
): Promise<Result<CampaignResult>> {
  const res = await coopRequest<LoopResponse>(
    "personalization",
    url("/search/products/promotions", store),
    {
      method: "POST",
      body: { resultsOptions: { skip: page * size, take: size, sortBy: [], facets: [] } },
    },
  );
  if (!res.ok) return res;
  return ok({
    storeId: store,
    totalHits: res.data.results?.count ?? 0,
    products: products(res.data.results),
  });
}
