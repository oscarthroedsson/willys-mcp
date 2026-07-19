import { BASE, cartItem, ENDPOINTS, REMOVE_QUANTITY } from "../constants/index.js";
import { apiHeaders, fetchCsrf, request } from "../core/http.js";
import { log } from "../core/logger.js";
import { err, ok, type Result } from "../core/result.js";
import { toProduct, type Product } from "../domain/product.js";
import {
  UpstreamCart,
  UpstreamProduct,
  UpstreamCustomer,
  UpstreamOrders,
  UpstreamSearch,
} from "./schemas.js";

/** Parse with a permissive schema, converting shape failures into SHAPE errors. */
function parse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
  value: unknown,
): Result<T> {
  const r = schema.safeParse(value);
  if (!r.success || r.data === undefined) {
    return err("SHAPE", `Oväntat svarsformat: ${String(r.error).slice(0, 200)}`);
  }
  return ok(r.data);
}

export interface SearchPage {
  products: Product[];
  page: number;
  pages: number;
  total: number;
}

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

export interface CartView {
  code: string | null;
  total: string | null;
  items: number;
  discount: string | null;
  products: Array<Product & { quantity: number | null }>;
}

export async function getCart(cookies: string): Promise<Result<CartView>> {
  const csrf = await fetchCsrf(cookies);
  if (!csrf.ok) return csrf;

  const res = await request(ENDPOINTS.cart, {
    cookies,
    csrfToken: csrf.data,
  });
  if (!res.ok) return res;

  const parsed = parse(UpstreamCart, res.data);
  if (!parsed.ok) return parsed;

  const c = parsed.data;
  return ok({
    code: c.code ?? null,
    total: c.totalPrice ?? null,
    items: c.totalItems ?? 0,
    discount: c.totalDiscount ?? null,
    products: (c.products ?? []).map((raw) => ({
      ...toProduct(raw),
      quantity: raw.quantity ?? null,
    })),
  });
}

export async function addToCart(
  cookies: string,
  productCode: string,
  quantity: number,
): Promise<Result<{ added: string; quantity: number }>> {
  const csrf = await fetchCsrf(cookies);
  if (!csrf.ok) return csrf;

  const res = await request(ENDPOINTS.addProducts, {
    method: "POST",
    cookies,
    csrfToken: csrf.data,
    body: { products: [cartItem(productCode, quantity)] },
  });
  if (!res.ok) return res;
  return ok({ added: productCode, quantity });
}

export async function removeFromCart(
  cookies: string,
  productCode: string,
): Promise<Result<{ removed: string }>> {
  const csrf = await fetchCsrf(cookies);
  if (!csrf.ok) return csrf;

  // Removal is an add with qty 0 — Willys has no dedicated delete endpoint.
  const res = await request(ENDPOINTS.addProducts, {
    method: "POST",
    cookies,
    csrfToken: csrf.data,
    body: { products: [cartItem(productCode, REMOVE_QUANTITY)] },
  });
  if (!res.ok) return res;
  return ok({ removed: productCode });
}

export interface OrderSummary {
  id: string;
  date: string;
  status: "levererad" | "pagaende";
  total: number | null;
}

export async function getOrders(
  cookies: string,
  limit = 10,
  offset = 0,
): Promise<Result<{ orders: OrderSummary[]; total: number }>> {
  const res = await request(ENDPOINTS.orders, { cookies });
  if (!res.ok) return res;

  const parsed = parse(UpstreamOrders, res.data);
  if (!parsed.ok) return parsed;

  // 69 orders arrive as 45 KB in a single unpaginated response. Slicing here
  // keeps the model's context from absorbing all of it.
  const all = parsed.data;
  const slice = all.slice(offset, offset + limit).map((o) => ({
    id: String(o.orderNumber ?? o.code ?? o.guid ?? ""),
    date: o.deliveryFormattedDate ?? o.formattedOrderDate ?? "",
    status: (o.complete || o.completed ? "levererad" : "pagaende") as
      | "levererad"
      | "pagaende",
    total:
      typeof o.total === "number"
        ? o.total
        : typeof o.total === "string"
          ? Number.parseFloat(o.total.replace(/\s/g, "").replace(",", "."))
          : null,
  }));

  return ok({ orders: slice, total: all.length });
}

export async function getCustomer(
  cookies: string,
): Promise<Result<{ id: string | null; name: string | null }>> {
  const res = await request(ENDPOINTS.customer, { cookies });
  if (!res.ok) return res;

  const parsed = parse(UpstreamCustomer, res.data);
  if (!parsed.ok) return parsed;

  const c = parsed.data;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return ok({ id: c.uid ?? null, name: name || null });
}

// ---------------------------------------------------------------------------
// Remaining read surfaces
// ---------------------------------------------------------------------------

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

export interface ProductDetail extends Product {
  ingredients: string | null;
  description: string | null;
  nutrition: unknown[] | null;
  /** e.g. "100 gram" — what the nutrition figures refer to. */
  nutritionBasis: string | null;
}

/**
 * Product detail over plain REST.
 *
 * Replaces `_next/data/{buildId}/produktdetalj/{code}.json`, whose build id
 * rotates on every Willys deploy — the previous implementation hardcoded
 * `a4eecdbf` and silently 404'd for months. This route carries 90 fields
 * including ingredients and nutrition, and has no build id to go stale.
 */
export async function getProductDetail(
  cookies: string,
  productCode: string,
): Promise<Result<ProductDetail>> {
  const url = `${ENDPOINTS.product}/${encodeURIComponent(productCode)}`;
  const res = await request<Record<string, unknown>>(url, { cookies });
  if (!res.ok) {
    // Willys answers 400, not 404, for a product code that does not exist.
    // Surfacing that as UPSTREAM would read as an outage rather than a typo.
    if (res.status === 400) {
      return err("NOT_FOUND", `Ingen produkt med koden ${productCode}`, 400);
    }
    return res;
  }

  const parsed = UpstreamProduct.safeParse(res.data);
  if (!parsed.success) return err("SHAPE", "Oväntat format på produktsvaret");

  const raw = res.data;
  const str = (k: string) =>
    typeof raw[k] === "string" && raw[k] ? (raw[k] as string) : null;

  // `nutritionFacts` is an empty string on every product inspected; the real
  // data lives in `nutritionsFactList` (note the s). Easy field to pick wrong.
  const nutrition = Array.isArray(raw.nutritionsFactList)
    ? raw.nutritionsFactList
    : null;

  return ok({
    ...toProduct(parsed.data),
    ingredients: str("ingredients"),
    description: str("description"),
    nutrition,
    nutritionBasis: str("nutritionDescription"),
  });
}

export interface OrderLine {
  name: string;
  code: string | null;
  quantity: string | null;
  category: string;
}

export async function getOrderDetails(
  cookies: string,
  orderId: string,
): Promise<Result<{ id: string; lines: OrderLine[] }>> {
  const url = `${BASE}/axfood/rest/orderdata?q=${encodeURIComponent(orderId)}`;
  const res = await request<{
    categoryOrderedDeliveredProducts?: Record<string, unknown[]>;
  }>(url, { cookies });
  if (!res.ok) return res;

  const byCategory = res.data.categoryOrderedDeliveredProducts ?? {};
  const lines: OrderLine[] = [];
  for (const [category, items] of Object.entries(byCategory)) {
    for (const item of items ?? []) {
      const p = item as Record<string, unknown>;
      const name = typeof p.name === "string" ? p.name : null;
      if (!name) continue;
      lines.push({
        name,
        code: typeof p.code === "string" ? p.code : null,
        quantity:
          typeof p.displayQuantity === "string" ? p.displayQuantity : null,
        category,
      });
    }
  }
  return ok({ id: orderId, lines });
}

export interface FrequentProduct {
  name: string;
  code: string | null;
  timesBought: number;
  category: string;
}

/**
 * "Mina vanligaste varor" derived from real order history.
 *
 * The CMS endpoint the previous implementation used (pageLabelOrId=
 * minavanligastevaror) returns a 22 KB page shell containing zero product
 * codes, so that tool never returned anything useful. Order history is both
 * accurate and personal: for "riven ost" you want the cheese this household
 * actually buys, not the semantically nearest one.
 */
export async function getFrequentProducts(
  cookies: string,
  scanOrders: number,
  limit: number,
): Promise<Result<{ scanned: number; products: FrequentProduct[] }>> {
  const list = await request<Array<Record<string, unknown>>>(ENDPOINTS.orders, {
    cookies,
  });
  if (!list.ok) return list;

  const ids = list.data
    .map((o) => String(o.orderNumber ?? o.code ?? o.guid ?? ""))
    .filter(Boolean)
    .slice(0, scanOrders);

  const tally = new Map<string, FrequentProduct>();

  for (const id of ids) {
    const detail = await getOrderDetails(cookies, id);
    if (!detail.ok) continue;
    for (const line of detail.data.lines) {
      const key = line.code ?? line.name;
      const existing = tally.get(key);
      if (existing) existing.timesBought += 1;
      else
        tally.set(key, {
          name: line.name,
          code: line.code,
          timesBought: 1,
          category: line.category,
        });
    }
  }

  const products = [...tally.values()]
    .sort((a, b) => b.timesBought - a.timesBought)
    .slice(0, limit);

  return ok({ scanned: ids.length, products });
}


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
