import { ENDPOINTS } from "../constants/index.js";
import { request } from "../core/http.js";
import { err, ok, type Result } from "../core/result.js";
import { toProduct, type Product } from "../domain/product.js";
import { UpstreamProduct } from "./schemas.js";

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
  const str = (key: string): string | null =>
    typeof raw[key] === "string" && raw[key] ? (raw[key] as string) : null;

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
