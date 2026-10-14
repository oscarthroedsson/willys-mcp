import { axfoodEndpoints, type AxfoodSite } from "../../constants/index.js";
import { request } from "../../core/http.js";
import { err, ok, type Result } from "../../core/result.js";
import type { Store, StoreDetail } from "../../chains/types.js";

/**
 * Axfood store registry: the whole chain in one unauthenticated call.
 *
 * `/axfood/rest/store` returns every store (259 Willys, 206 Hemköp on
 * 2026-10-13) with address, coordinates and e-commerce flags. It replaced the
 * geo search `search/store?q=&lat=&lng=`, which works on Willys but answers
 * `results: null` on Hemköp with the same parameters.
 */

interface RawStore {
  storeId?: string;
  name?: string;
  displayName?: string;
  clickAndCollect?: boolean;
  onlineStore?: boolean;
  willysHemma?: boolean;
  external?: boolean;
  openingHours?: string[];
  address?: {
    line1?: string | null;
    postalCode?: string | null;
    town?: string | null;
    phone?: string | null;
  } | null;
  geoPoint?: { latitude?: number; longitude?: number } | null;
}

function toStore(site: AxfoodSite, r: RawStore): Store | null {
  if (!r.storeId || !(r.name ?? r.displayName)) return null;
  const a = r.address ?? {};
  const lat = r.geoPoint?.latitude ?? null;
  const lng = r.geoPoint?.longitude ?? null;
  return {
    chain: site.chain,
    storeId: String(r.storeId),
    name: String(r.name ?? r.displayName),
    street: a.line1 ?? null,
    postalCode: a.postalCode ?? null,
    town: a.town ?? null,
    phone: a.phone ?? null,
    // 0,0 is "no position", not the Gulf of Guinea (Willys 2002 has it).
    lat: lat === 0 && lng === 0 ? null : lat,
    lng: lat === 0 && lng === 0 ? null : lng,
    ecommerce: r.clickAndCollect === true || r.onlineStore === true,
    kind: r.willysHemma ? "Willys Hemma" : null,
    openingHours: r.openingHours?.length ? r.openingHours.join(" | ") : null,
  };
}

export async function listStores(site: AxfoodSite): Promise<Result<Store[]>> {
  const res = await request<unknown>(axfoodEndpoints(site).storeList, {
    label: site.label,
  });
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return err("SHAPE", "Butikslistan var inte en lista");

  const stores = (res.data as RawStore[])
    .filter((r) => r.external !== true)
    .map((r) => toStore(site, r))
    .filter((s): s is Store => s !== null);
  if (stores.length === 0) return err("SHAPE", `${site.label} gav noll butiker`);
  return ok(stores);
}

export async function storeDetail(
  site: AxfoodSite,
  storeId: string,
): Promise<Result<StoreDetail>> {
  const res = await request<Record<string, unknown>>(
    `${axfoodEndpoints(site).storeDetail}/${encodeURIComponent(storeId)}`,
    { label: site.label },
  );
  if (!res.ok) {
    if (res.status === 400 || res.status === 404 || res.kind === "NOT_FOUND") {
      return err("NOT_FOUND", `Ingen butik med id ${storeId} hos ${site.label}`, res.status);
    }
    return res;
  }

  const raw = res.data;
  const base = toStore(site, raw as RawStore);
  if (!base) return err("SHAPE", "Butikssvaret saknade id eller namn");

  const extra: Record<string, string> = {};
  const add = (label: string, key: string) => {
    if (typeof raw[key] === "string" && raw[key]) extra[label] = raw[key] as string;
  };
  // Digital flyer for this store — the offers surface that get_offers lost.
  add("erbjudandeblad", "flyerURL");
  add("upphamtningsavgift", "pickupInStoreCost");
  add("plockavgift_upphamtning", "pickingCostForCollect");
  add("plockavgift_hemleverans", "pickingCostForDelivery");
  add("fri_frakt_fran", "freeDeliveryThresholdFormatted");
  add("kundtjanst", "customerServicePhone");

  return ok({ ...base, extra });
}
