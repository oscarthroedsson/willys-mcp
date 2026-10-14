import { COOP } from "../../constants/index.js";
import { err, ok, type Result } from "../../core/result.js";
import type { Store, StoreDetail } from "../../chains/types.js";
import { coopRequest } from "./http.js";

/**
 * Coop stores.
 *
 * Only e-commerce stores have an online assortment, so the registry is the
 * Hybris point-of-service list: `pointofservices?query=&pageSize=500` returns
 * all 250 of them in one call (2026-10-14) with the 6-digit ledger number as
 * `name` — the value search takes as `store` — plus address and coordinates.
 * The store API's own list (787 stores) has neither address nor coordinates
 * and includes stores that cannot be searched, so it is not used.
 */

interface RawPos {
  name?: string;
  displayName?: string;
  address?: {
    line1?: string | null;
    postalCode?: string | null;
    town?: string | null;
    phone?: string | null;
  } | null;
  geoPoint?: { latitude?: number; longitude?: number } | null;
}

function toStore(r: RawPos): Store | null {
  if (!r.name || !r.displayName) return null;
  const a = r.address ?? {};
  const concept = /^(Stora Coop|Coop Forum|X:-tra|Coop Nära|Coop Konsum)/.exec(r.displayName)?.[1];
  return {
    chain: "coop",
    storeId: r.name,
    name: r.displayName,
    street: a.line1 ?? null,
    postalCode: a.postalCode ?? null,
    town: a.town ?? null,
    // The e-commerce list carries the national customer service number on
    // every store; it says nothing about the store.
    phone: null,
    lat: r.geoPoint?.latitude ?? null,
    lng: r.geoPoint?.longitude ?? null,
    ecommerce: true,
    kind: concept ?? "Coop",
    openingHours: null,
  };
}

export async function listStores(): Promise<Result<Store[]>> {
  const res = await coopRequest<{ stores?: RawPos[] }>(
    "hybris",
    `${COOP.hybris}/pointofservices?query=&pageSize=500&fields=FULL&api-version=v1`,
  );
  if (!res.ok) return res;
  const stores = (res.data.stores ?? []).map(toStore).filter((s): s is Store => s !== null);
  if (stores.length === 0) return err("SHAPE", "Coop gav noll e-handelsbutiker");
  return ok(stores);
}

/** Which e-commerce store serves a postcode: 41301 → 252500 Stora Coop Bäckebol. */
export async function storeForPostcode(postcode: string): Promise<Result<Store>> {
  const clean = postcode.replace(/\s/g, "");
  const res = await coopRequest<{ code?: string; name?: string }>(
    "hybris",
    `${COOP.hybris}/coopstore?postCode=${encodeURIComponent(clean)}&fields=BASIC&api-version=v1`,
  );
  if (!res.ok) {
    if (res.status === 400 || res.status === 404) {
      return err("NOT_FOUND", `Coop har ingen e-handelsbutik för postnummer ${clean}`, res.status);
    }
    return res;
  }
  if (!res.data.code || !res.data.name) {
    return err("NOT_FOUND", `Coop har ingen e-handelsbutik för postnummer ${clean}`);
  }
  return ok({
    chain: "coop",
    storeId: res.data.code,
    name: res.data.name,
    street: null,
    postalCode: null,
    town: null,
    phone: null,
    lat: null,
    lng: null,
    ecommerce: true,
    kind: null,
    openingHours: null,
  });
}

interface RawStoreDetail {
  ledgerAccountNumber?: string;
  name?: string;
  concept?: { name?: string } | null;
  streetAddress?: string | null;
  postalCode?: string | null;
  city?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openingHoursToday?: string | null;
  weeklyOffersLink?: string | null;
  isAvailableForDr?: boolean | null;
  openingHours?: Array<{ text?: string; openHoursText?: string }> | null;
}

/** Store detail from the store API. Takes the 6-digit ledger number, not storeId. */
export async function storeDetail(ledger: string): Promise<Result<StoreDetail>> {
  if (!/^\d{6}$/.test(ledger)) {
    return err("INPUT", "Coops butiks-id är ett 6-siffrigt ledger-nummer, t.ex. 251300.");
  }
  const res = await coopRequest<RawStoreDetail>(
    "store",
    `${COOP.store}/stores/${ledger}?api-version=v2`,
  );
  if (!res.ok) {
    if (res.status === 400 || res.status === 404) {
      return err("NOT_FOUND", `Ingen Coop-butik med id ${ledger}`, res.status);
    }
    return res;
  }
  const r = res.data;
  if (!r.name) return err("SHAPE", "Coops butikssvar saknade namn");

  const hours = (r.openingHours ?? [])
    .map((h) => (h.text && h.openHoursText ? `${h.text} ${h.openHoursText}` : null))
    .filter(Boolean)
    .join(" | ");
  const extra: Record<string, string> = {};
  if (r.weeklyOffersLink) extra.erbjudandeblad = r.weeklyOffersLink;
  if (r.openingHoursToday) extra.oppet_idag = r.openingHoursToday;

  return ok({
    chain: "coop",
    storeId: r.ledgerAccountNumber ?? ledger,
    name: r.name,
    street: r.streetAddress ?? null,
    postalCode: r.postalCode ?? null,
    town: r.city ?? null,
    phone: r.phone ?? null,
    lat: r.latitude ?? null,
    lng: r.longitude ?? null,
    ecommerce: false,
    kind: r.concept?.name ?? null,
    openingHours: hours || null,
    extra,
  });
}
