import { cartItem, ENDPOINTS, REMOVE_QUANTITY } from "../constants/index.js";
import { fetchCsrf, request } from "../core/http.js";
import { ok, type Result } from "../core/result.js";
import { toProduct, type Product } from "../domain/product.js";
import { parse } from "./parse.js";
import { UpstreamCart } from "./schemas.js";

export interface CartView {
  code: string | null;
  total: string | null;
  items: number;
  discount: string | null;
  products: Array<Product & { quantity: number | null }>;
}

/**
 * Cart contents.
 *
 * Every cart route is CSRF-protected, including this read — the token is
 * fetched per call rather than cached, since it is bound to the session cookie
 * and cheap relative to the request it guards.
 */
export async function getCart(cookies: string): Promise<Result<CartView>> {
  const csrf = await fetchCsrf(cookies);
  if (!csrf.ok) return csrf;

  const res = await request(ENDPOINTS.cart, { cookies, csrfToken: csrf.data });
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
