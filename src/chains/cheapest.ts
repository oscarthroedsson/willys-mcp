import { ok, type Result } from "../core/result.js";
import type { Product } from "../domain/product.js";
import {
  packagesNeeded,
  parseRequirement,
  parseVolume,
  type PackageMath,
} from "../domain/volume.js";
import {
  isUnwantedPetFood,
  looselyRelates,
  onlyAsModifier,
  nameContainsTerm,
  nameHasSubstring,
} from "../domain/name-match.js";
import { vetUnitPrice, type UnitPriceSource } from "../domain/unit-price.js";
import type { AdapterCtx, CategoryOption, ChainAdapter } from "./types.js";

/**
 * "Cheapest" for any chain: fetch candidates from the adapter, filter, rank.
 *
 * The adapter only fetches. Filtering and ranking live here so that every
 * chain gets the same guards — the name check that stops "torkad dragon"
 * matching a dog chew, the brand and origin filters, the package maths — and
 * so that ranking never trusts an upstream sort. Only Axfood sorts correctly on
 * comparison price; City Gross ignores campaign prices and Mathem cannot sort
 * at all (docs/kedjor.md).
 */

export interface CheapestOptions {
  query: string;
  /**
   * Facet value from `availableCategories`, e.g. "Kött" or "Fågel". Applied
   * upstream. Deliberately a free string rather than an enum: facets are
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
  /**
   * Reject products whose name contains any of these (substring).
   *
   * The complement of mustContain: mustNotContain ["margarin","picklad","sås"]
   * removes the near-misses that share the head noun — picklad rödlök when you
   * want fresh, margarin when you want butter.
   */
  mustNotContain?: string[] | undefined;
  /** Requirement text such as "1.7 kg" — enables package maths. */
  need?: string | undefined;
  /**
   * The compare unit to rank first. Derived from `need` when not given: a need
   * in pieces must see kr/st products first even when kr/kg ones are the
   * majority (äggnudlar outnumber eggs for "ägg").
   */
  preferUnit?: "kg" | "l" | "st" | undefined;
  limit: number;
}

export interface RankedProduct extends Product {
  /** Whether perUnit is upstream's, our own (upstream disagreed), or unverifiable. */
  perUnitSource: UnitPriceSource;
  packaging: PackageMath | null;
  /** What covering `need` with this product actually costs. */
  estimatedCost: number | null;
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
    excludedWord: number;
    petFood: number;
  };
  products: RankedProduct[];
  /** Set when the cheapest per-unit option is not the cheapest way to cover `need`. */
  note?: string;
}

/**
 * Cheapest per unit first; products without a comparable price last, in the
 * order they arrived. Stable, so equal prices keep upstream relevance order.
 * Only meaningful within one compare unit — see rankByUnit for mixed sets.
 */
export function byUnitPrice<T extends Pick<Product, "perUnit">>(a: T, b: T): number {
  if (a.perUnit === null && b.perUnit === null) return 0;
  if (a.perUnit === null) return 1;
  if (b.perUnit === null) return -1;
  return a.perUnit - b.perUnit;
}

/** The filter and ranking pass, separated from fetching so it can be tested offline. */
export function rankCandidates(
  rows: Product[],
  opts: CheapestOptions,
): Pick<CheapestResult, "filteredOut" | "products" | "note"> {
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
    excludedWord: 0,
    petFood: 0,
  };

  const required = opts.mustContain ?? [];
  const forbidden = opts.mustNotContain ?? [];

  const kept: Array<Product & { perUnitSource: UnitPriceSource }> = [];
  for (const raw of rows) {
    // Vet the comparison price first: a wrong upstream figure must neither
    // rank a product first nor hide it.
    const p = vetUnitPrice(raw);
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
    // Word/suffix match, not substring: "smör" must not pass "Smörgåsmargarin".
    if (required.length > 0 && !required.every((w) => nameContainsTerm(p.name, w))) {
      filteredOut.irrelevantName++;
      continue;
    }
    // No explicit mustContain: still drop products that share no word with the
    // query at all — the "mineralvatten -> tampons" class of junk.
    if (
      required.length === 0 &&
      opts.query.trim() !== "" &&
      (!looselyRelates(p.name, opts.query) || onlyAsModifier(p.name, opts.query))
    ) {
      filteredOut.irrelevantName++;
      continue;
    }
    if (forbidden.length > 0 && forbidden.some((w) => nameHasSubstring(p.name, w))) {
      filteredOut.excludedWord++;
      continue;
    }
    if (isUnwantedPetFood(p, opts.query)) {
      filteredOut.petFood++;
      continue;
    }
    kept.push(p);
  }

  const need = opts.need ? parseRequirement(opts.need) : null;
  const preferUnit =
    opts.preferUnit ??
    (need ? ({ mass: "kg", volume: "l", count: "st" } as const)[need.measure] : undefined);

  // The server ranks, never the upstream order.
  const { ordered, mixedNote } = rankByUnit(kept, preferUnit);
  kept.length = 0;
  kept.push(...ordered);

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
  let note: string | undefined = mixedNote;
  if (need) {
    const withCost = ranked.filter((p) => p.estimatedCost !== null);
    if (withCost.length > 0) {
      const cheapestPerUnit = ranked[0];
      withCost.sort((a, b) => a.estimatedCost! - b.estimatedCost!);
      if (cheapestPerUnit && withCost[0]?.code !== cheapestPerUnit.code) {
        note =
          "Rangordnat på total kostnad för behovet, inte på jämförpris. " +
          `Billigast per enhet (${cheapestPerUnit.name}) kräver mer förpackning än du behöver.` +
          (mixedNote ? ` ${mixedNote}` : "");
      }
      const rest = ranked.filter((p) => p.estimatedCost === null);
      ranked.length = 0;
      ranked.push(...withCost, ...rest);
    }
  }

  return note ? { filteredOut, products: ranked, note } : { filteredOut, products: ranked };
}

/**
 * Rank by unit price within the dominant compare unit, others after.
 *
 * kr/kg and kr/st are not comparable: a 10 kr/st egg is not cheaper than
 * 60 kr/kg mince in any useful sense. The unit most products share comes
 * first, ranked; the rest follow, ranked among themselves, and the caller is
 * told so instead of reading one list as if it were one scale.
 */
export function rankByUnit<T extends Pick<Product, "perUnit" | "compareUnit">>(
  items: T[],
  prefer?: string,
): { ordered: T[]; mixedNote?: string } {
  const counts = new Map<string, number>();
  for (const p of items) {
    if (p.perUnit !== null && p.compareUnit) {
      counts.set(p.compareUnit, (counts.get(p.compareUnit) ?? 0) + 1);
    }
  }
  if (counts.size <= 1) return { ordered: [...items].sort(byUnitPrice) };

  // The unit the need is stated in wins when any product has it; otherwise the
  // unit most products share.
  const primary =
    prefer && counts.has(prefer) ? prefer : [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  const first = items.filter((p) => p.compareUnit === primary).sort(byUnitPrice);
  const rest = items.filter((p) => p.compareUnit !== primary).sort(byUnitPrice);
  return {
    ordered: [...first, ...rest],
    mixedNote:
      `Träffarna har olika jämförenheter (${[...counts.keys()].join(", ")}). ` +
      `Rangordnat på kr/${primary} först; övriga enheter efter, eftersom de inte är jämförbara.`,
  };
}

export async function findCheapest(
  adapter: ChainAdapter,
  ctx: AdapterCtx,
  opts: CheapestOptions,
): Promise<Result<CheapestResult>> {
  const res = await adapter.candidates(ctx, {
    query: opts.query,
    category: opts.category,
  });
  if (!res.ok) return res;

  const ranked = rankCandidates(res.data.products, opts);
  const result: CheapestResult = {
    totalHits: res.data.totalHits,
    inspected: res.data.products.length,
    availableCategories: res.data.categories,
    appliedCategory: res.data.appliedCategory,
    filteredOut: ranked.filteredOut,
    products: ranked.products.slice(0, opts.limit),
  };
  if (ranked.note) result.note = ranked.note;
  return ok(result);
}
