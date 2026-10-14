import { err, ok, type Result } from "../../core/result.js";
import type { Store } from "../../chains/types.js";
import { cgGet } from "./http.js";

/**
 * City Gross stores: `sites?siteTypeId=3` lists every store (38 on 2026-10-14)
 * with address and `storeNumber`, the value search takes as `store`. No
 * coordinates, so nearest-store lookups are not possible for City Gross.
 */

interface RawSite {
  id?: number;
  name?: string;
  streetAddress?: string | null;
  zipcode?: string | null;
  city?: string | null;
  phone?: string | null;
  storeNumber?: string | null;
}

export async function listStores(): Promise<Result<Store[]>> {
  const res = await cgGet<{ sites?: RawSite[] }>("/sites?siteTypeId=3");
  if (!res.ok) return res;
  const stores = (res.data.sites ?? [])
    .filter((s) => s.storeNumber && s.name)
    .map(
      (s): Store => ({
        chain: "citygross",
        storeId: String(s.storeNumber),
        name: String(s.name),
        street: s.streetAddress ?? null,
        postalCode: s.zipcode ?? null,
        town: s.city ?? null,
        phone: s.phone ?? null,
        lat: null,
        lng: null,
        // The store parameter scopes the online assortment, so every store
        // listed here sells online (pickup or delivery).
        ecommerce: true,
        kind: null,
        openingHours: null,
      }),
    );
  if (stores.length === 0) return err("SHAPE", "City Gross gav noll butiker");
  return ok(stores);
}
