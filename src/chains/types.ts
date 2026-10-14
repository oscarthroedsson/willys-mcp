import type { Result } from "../core/result.js";
import type { Product } from "../domain/product.js";

/**
 * The contract every grocery chain implements.
 *
 * Tools are generic over `chain`; under them sits one adapter per *platform*,
 * not per store — Willys and Hemköp are the same Axfood API with a different
 * base URL, so they share one implementation with two configurations. See
 * docs/kedjor.md for what each platform exposes and why ICA is not here.
 *
 * Adapters return the shared domain `Product` so that ranking, filtering and
 * planning never need to know which chain a product came from. Anything
 * chain-specific stays inside the adapter.
 */

export const CHAIN_IDS = ["willys", "hemkop", "coop", "citygross", "mathem"] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

/**
 * What an adapter can do. A tool declares the capability it needs and the
 * dispatcher refuses up front when the chain lacks it — the model gets "Coop
 * has no cart here, these chains do" instead of a broken upstream call.
 */
export type Capability =
  | "search"
  | "suggestions"
  | "product"
  | "cheapest"
  | "campaigns"
  | "stores"
  | "login"
  | "cart"
  | "orders";

/**
 * How a store affects what the chain returns.
 *
 * - none: one national assortment and price list (Mathem).
 * - optional: prices or assortment vary by store, but a default answers (Axfood,
 *   City Gross).
 * - required: no store, no assortment (Coop — only e-commerce stores have one).
 */
export type StoreScope = "none" | "optional" | "required";

export interface AdapterCtx {
  /** Session cookies for authenticated chains; "" for anonymous calls. */
  cookies: string;
  /** The store prices and assortment are taken from, when the chain cares. */
  storeId?: string | undefined;
}

export interface SearchPage {
  products: Product[];
  page: number;
  pages: number;
  total: number;
}

export interface ProductDetail extends Product {
  ingredients: string | null;
  description: string | null;
  nutrition: unknown[] | null;
  /** e.g. "100 gram" — what the nutrition figures refer to. */
  nutritionBasis: string | null;
}

export interface CategoryOption {
  name: string;
  count: number;
}

/**
 * The raw material for "cheapest": as many matching products as the chain
 * gives in one bounded fetch, plus the category facet for narrowing.
 *
 * Ranking is NOT the adapter's job. Only Axfood sorts correctly on comparison
 * price upstream (City Gross ignores campaign prices, Mathem cannot sort at
 * all), so the shared layer always sorts itself — see chains/cheapest.ts.
 */
export interface CandidateSet {
  totalHits: number;
  products: Product[];
  categories: CategoryOption[];
  appliedCategory: string | null;
}

export interface CandidateQuery {
  query: string;
  /** A facet value from a previous `categories`, applied upstream. */
  category?: string | undefined;
}

export interface CampaignResult {
  storeId: string;
  totalHits: number;
  products: Product[];
}

export interface Store {
  chain: ChainId;
  storeId: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  town: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  /** Can be ordered from online (delivery or pickup). */
  ecommerce: boolean;
  /** Concept or format: "Stora Coop", "Willys Hemma" … */
  kind: string | null;
  openingHours: string | null;
}

export interface StoreDetail extends Store {
  /** Chain-specific facts worth showing: flyer URL, picking fee … */
  extra: Record<string, string>;
}

export interface ChainAdapter {
  readonly id: ChainId;
  /** For text the model and the user read: "Willys", "Hemköp" … */
  readonly displayName: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly storeScope: StoreScope;
  /** Validates a product code before it is sent upstream. */
  readonly productCode: { pattern: RegExp; hint: string };

  search(ctx: AdapterCtx, query: string, page: number, size: number): Promise<Result<SearchPage>>;
  suggestions(ctx: AdapterCtx, term: string): Promise<Result<string[]>>;
  product(ctx: AdapterCtx, code: string): Promise<Result<ProductDetail>>;
  candidates(ctx: AdapterCtx, q: CandidateQuery): Promise<Result<CandidateSet>>;
  campaigns?(ctx: AdapterCtx, storeId: string, page: number, size: number): Promise<Result<CampaignResult>>;

  /** The whole store registry in one go, for the local cache. */
  listStores?(): Promise<Result<Store[]>>;
  storeDetail?(storeId: string): Promise<Result<StoreDetail>>;
  /** Coop: which e-commerce store serves a postcode. */
  storeForPostcode?(postcode: string): Promise<Result<Store>>;
}
