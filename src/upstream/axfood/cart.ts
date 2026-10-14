import {
  axfoodEndpoints,
  cartItem,
  REMOVE_QUANTITY,
  type AxfoodSite,
} from "../../constants/index.js";
import { fetchCsrf, request } from "../../core/http.js";
import { ok, type Result } from "../../core/result.js";
import { toProduct, type Product } from "../../domain/product.js";
import { parse } from "./parse.js";
import { UpstreamCart } from "./schemas.js";

export interface CartLine extends Product {
  /** Raw quantity — packages for count goods, grams for loose _KG goods. */
  quantity: number | null;
  /** "st" or "g", so `quantity` is never read as the wrong unit. */
  quantityUnit: "st" | "g";
  /** Ready-to-show, e.g. "900 g" or "1 st" — never a bare ambiguous number. */
  quantityDisplay: string;
}

export interface CartView {
  code: string | null;
  total: string | null;
  items: number;
  discount: string | null;
  products: CartLine[];
}

/**
 * Cart contents.
 *
 * Every cart route is CSRF-protected, including this read — the token is
 * fetched per call rather than cached, since it is bound to the session cookie
 * and cheap relative to the request it guards.
 */
export async function getCart(
  site: AxfoodSite,
  cookies: string,
): Promise<Result<CartView>> {
  const csrf = await fetchCsrf(cookies, site);
  if (!csrf.ok) return csrf;

  const res = await request(axfoodEndpoints(site).cart, {
    cookies,
    csrfToken: csrf.data,
    label: site.label,
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
    products: (c.products ?? []).map((raw) => {
      const product = toProduct(raw);
      const quantity = raw.quantity ?? null;
      // The code suffix is the sale unit: _KG is weighed (quantity is grams),
      // everything else is counted (quantity is packages). Willys reuses one
      // `quantity` field for both, which is what turned "900 g gurka" into
      // "9× gurka" in a summary.
      const weighed = product.code.endsWith("_KG");
      const quantityUnit: "st" | "g" = weighed ? "g" : "st";
      return {
        ...product,
        quantity,
        quantityUnit,
        quantityDisplay:
          quantity === null ? "?" : `${quantity} ${quantityUnit}`,
      };
    }),
  });
}

export async function addToCart(
  site: AxfoodSite,
  cookies: string,
  productCode: string,
  quantity: number,
): Promise<Result<{ added: string; quantity: number }>> {
  const csrf = await fetchCsrf(cookies, site);
  if (!csrf.ok) return csrf;

  const res = await request(axfoodEndpoints(site).addProducts, {
    method: "POST",
    label: site.label,
    cookies,
    csrfToken: csrf.data,
    body: { products: [cartItem(productCode, quantity)] },
  });
  if (!res.ok) return res;
  return ok({ added: productCode, quantity });
}

export async function removeFromCart(
  site: AxfoodSite,
  cookies: string,
  productCode: string,
): Promise<Result<{ removed: string }>> {
  const csrf = await fetchCsrf(cookies, site);
  if (!csrf.ok) return csrf;

  // Removal is an add with qty 0 — Axfood has no dedicated delete endpoint.
  const res = await request(axfoodEndpoints(site).addProducts, {
    method: "POST",
    label: site.label,
    cookies,
    csrfToken: csrf.data,
    body: { products: [cartItem(productCode, REMOVE_QUANTITY)] },
  });
  if (!res.ok) return res;
  return ok({ removed: productCode });
}
