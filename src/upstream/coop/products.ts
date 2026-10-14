import { COOP } from "../../constants/index.js";
import { err, ok, type Result } from "../../core/result.js";
import type { ProductDetail } from "../../chains/types.js";
import { coopRequest } from "./http.js";
import { toCoopProduct, type CoopItem } from "./map.js";

/**
 * One product by EAN: `POST /search/entities/by-id` with a bare array body.
 *
 * Search hits already carry ingredients and nutrition, so this is mostly for a
 * code the model got elsewhere. `["<ean>"]` is the body the storefront sends;
 * an object body answers 400 "Failed to read HTTP message".
 */
export async function getProduct(store: string, ean: string): Promise<Result<ProductDetail>> {
  const res = await coopRequest<{ results?: { items?: CoopItem[] } }>(
    "personalization",
    `${COOP.personalization}/search/entities/by-id?${COOP.searchParams}&store=${encodeURIComponent(store)}`,
    { method: "POST", body: [ean] },
  );
  if (!res.ok) return res;

  const item = res.data.results?.items?.[0];
  const product = item ? toCoopProduct(item) : null;
  if (!item || !product) return err("NOT_FOUND", `Ingen produkt med EAN ${ean} hos Coop`);

  return ok({
    ...product,
    ingredients: item.listOfIngredients ?? null,
    description: item.description ?? null,
    nutrition: Array.isArray(item.nutrientInformation) ? item.nutrientInformation : null,
    nutritionBasis: nutritionBasis(item.nutrientInformation),
  });
}

/**
 * "100 gram" from the first nutrition block's header. `nutrientBasis` on the
 * item is only `{ quantity: 100 }` — the unit lives in the header.
 */
function nutritionBasis(info: unknown[] | null | undefined): string | null {
  const header = (info?.[0] as { header?: Record<string, unknown> } | undefined)?.header;
  const qty = header?.nutrientBasisQuantity;
  const unit = (header?.nutrientBasisQuantityUnit as { value?: string } | undefined)?.value;
  if (typeof qty !== "number") return null;
  return unit ? `${qty} ${unit.toLowerCase()}` : String(qty);
}
