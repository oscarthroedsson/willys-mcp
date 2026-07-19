import Database from "better-sqlite3";
import { DB_PATH } from "../config.js";
import { BASE } from "../constants/index.js";
import { apiHeaders } from "../core/http.js";
import { log } from "../core/logger.js";
import { err, ok, type Result } from "../core/result.js";

/**
 * Store registry — the lookup book.
 *
 * The whole Swedish chain (254 stores as of 2026-07-18) arrives in ONE
 * unauthenticated request with pageSize 400, so there is no need to sweep
 * coordinates or paginate. We fetch once, cache in SQLite, and serve lookups
 * locally. That turns "which store am I ordering from?" from an open question
 * into a table read.
 */

const STORE_SEARCH = `${BASE}/axfood/rest/search/store`;
const STORE_DETAIL = `${BASE}/axfood/rest/store`;

/** Geographic centre of Sweden-ish; the query returns everything regardless. */
const SWEEP = { lat: 59.3293, lng: 18.0686 };

export interface Store {
  storeId: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  town: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  clickAndCollect: boolean;
  willysHemma: boolean;
  openingHours: string | null;
}

let db: Database.Database | null = null;

function conn(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      storeId        TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      street         TEXT,
      postalCode     TEXT,
      town           TEXT,
      phone          TEXT,
      lat            REAL,
      lng            REAL,
      clickAndCollect INTEGER NOT NULL DEFAULT 0,
      willysHemma    INTEGER NOT NULL DEFAULT 0,
      openingHours   TEXT,
      refreshed_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stores_town ON stores(town);
    CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(name);
  `);
  return db;
}

interface RawStore {
  storeId?: string;
  name?: string;
  displayName?: string;
  clickAndCollect?: boolean;
  willysHemma?: boolean;
  openingHours?: string[];
  address?: {
    line1?: string | null;
    postalCode?: string | null;
    town?: string | null;
    phone?: string | null;
  } | null;
  geoPoint?: { latitude?: number; longitude?: number } | null;
}

function toStore(r: RawStore): Store | null {
  if (!r.storeId || !(r.name ?? r.displayName)) return null;
  const a = r.address ?? {};
  return {
    storeId: String(r.storeId),
    name: String(r.name ?? r.displayName),
    street: a.line1 ?? null,
    postalCode: a.postalCode ?? null,
    town: a.town ?? null,
    phone: a.phone ?? null,
    lat: r.geoPoint?.latitude ?? null,
    lng: r.geoPoint?.longitude ?? null,
    clickAndCollect: r.clickAndCollect === true,
    willysHemma: r.willysHemma === true,
    openingHours: r.openingHours?.length ? r.openingHours.join(" | ") : null,
  };
}

/** Fetch the full chain and replace the cache. Unauthenticated. */
export async function refreshStores(): Promise<Result<number>> {
  const url =
    `${STORE_SEARCH}?q=&lat=${SWEEP.lat}&lng=${SWEEP.lng}` +
    `&sort=score-desc&externalPickupLocation=false`;

  let payload: { results?: RawStore[] };
  try {
    const res = await fetch(url, { headers: apiHeaders("") });
    if (!res.ok) return err("UPSTREAM", `Butikssök svarade ${res.status}`, res.status);
    payload = (await res.json()) as { results?: RawStore[] };
  } catch (e) {
    return err("NETWORK", e instanceof Error ? e.message : String(e));
  }

  const stores = (payload.results ?? [])
    .map(toStore)
    .filter((s): s is Store => s !== null);

  if (stores.length === 0) return err("SHAPE", "Butikssöket gav noll träffar");

  const now = Date.now();
  const d = conn();
  const insert = d.prepare(`
    INSERT INTO stores (storeId,name,street,postalCode,town,phone,lat,lng,
                        clickAndCollect,willysHemma,openingHours,refreshed_at)
    VALUES (@storeId,@name,@street,@postalCode,@town,@phone,@lat,@lng,
            @cc,@wh,@openingHours,@now)
    ON CONFLICT(storeId) DO UPDATE SET
      name=excluded.name, street=excluded.street, postalCode=excluded.postalCode,
      town=excluded.town, phone=excluded.phone, lat=excluded.lat, lng=excluded.lng,
      clickAndCollect=excluded.clickAndCollect, willysHemma=excluded.willysHemma,
      openingHours=excluded.openingHours, refreshed_at=excluded.refreshed_at
  `);

  const tx = d.transaction((rows: Store[]) => {
    for (const s of rows) {
      insert.run({
        ...s,
        cc: s.clickAndCollect ? 1 : 0,
        wh: s.willysHemma ? 1 : 0,
        now,
      });
    }
  });
  tx(stores);

  log.info(`butiksregister uppdaterat: ${stores.length} butiker`);
  return ok(stores.length);
}

function rowToStore(r: Record<string, unknown>): Store {
  return {
    storeId: String(r.storeId),
    name: String(r.name),
    street: (r.street as string) ?? null,
    postalCode: (r.postalCode as string) ?? null,
    town: (r.town as string) ?? null,
    phone: (r.phone as string) ?? null,
    lat: (r.lat as number) ?? null,
    lng: (r.lng as number) ?? null,
    clickAndCollect: r.clickAndCollect === 1,
    willysHemma: r.willysHemma === 1,
    openingHours: (r.openingHours as string) ?? null,
  };
}

function count(): number {
  const r = conn().prepare("SELECT COUNT(*) AS n FROM stores").get() as {
    n: number;
  };
  return r.n;
}

/** Seed the cache on first use so lookups never return a misleading empty set. */
async function ensureSeeded(): Promise<Result<true>> {
  if (count() > 0) return ok(true);
  const r = await refreshStores();
  return r.ok ? ok(true) : r;
}

export async function findStores(
  query: string,
  onlyClickAndCollect: boolean,
  limit: number,
): Promise<Result<Store[]>> {
  const seeded = await ensureSeeded();
  if (!seeded.ok) return seeded;

  const like = `%${query.toLowerCase()}%`;
  const rows = conn()
    .prepare(
      `SELECT * FROM stores
       WHERE (lower(name) LIKE ? OR lower(town) LIKE ? OR postalCode LIKE ?)
         AND (0 = ? OR clickAndCollect = 1)
       ORDER BY willysHemma ASC, name ASC
       LIMIT ?`,
    )
    .all(like, like, like, onlyClickAndCollect ? 1 : 0, limit) as Record<
    string,
    unknown
  >[];

  return ok(rows.map(rowToStore));
}

/** Haversine distance in kilometres. */
function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function nearestStores(
  lat: number,
  lng: number,
  onlyClickAndCollect: boolean,
  limit: number,
): Promise<Result<Array<Store & { distanceKm: number }>>> {
  const seeded = await ensureSeeded();
  if (!seeded.ok) return seeded;

  const rows = conn()
    .prepare(
      `SELECT * FROM stores WHERE lat IS NOT NULL AND lng IS NOT NULL
       AND (0 = ? OR clickAndCollect = 1)`,
    )
    .all(onlyClickAndCollect ? 1 : 0) as Record<string, unknown>[];

  const ranked = rows
    .map(rowToStore)
    .map((s) => ({
      ...s,
      distanceKm: Number(distanceKm(lat, lng, s.lat!, s.lng!).toFixed(1)),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);

  return ok(ranked);
}

export interface StoreDetail extends Store {
  /** Digital flyer for this store — the offers surface that get_offers lost. */
  flyerUrl: string | null;
  pickupCost: string | null;
  pickingCostCollect: string | null;
  freeDeliveryThreshold: string | null;
  customerServicePhone: string | null;
}

export async function getStoreDetail(
  storeId: string,
): Promise<Result<StoreDetail>> {
  let raw: Record<string, unknown>;
  try {
    const res = await fetch(`${STORE_DETAIL}/${encodeURIComponent(storeId)}`, {
      headers: apiHeaders(""),
    });
    if (res.status === 404) return err("NOT_FOUND", `Ingen butik med id ${storeId}`);
    if (!res.ok) return err("UPSTREAM", `Butiken svarade ${res.status}`, res.status);
    raw = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    return err("NETWORK", e instanceof Error ? e.message : String(e));
  }

  const base = toStore(raw as RawStore);
  if (!base) return err("SHAPE", "Butikssvaret saknade id eller namn");

  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);

  return ok({
    ...base,
    flyerUrl: str("flyerURL"),
    pickupCost: str("pickupInStoreCost"),
    pickingCostCollect: str("pickingCostForCollect"),
    freeDeliveryThreshold: str("freeDeliveryThresholdFormatted"),
    customerServicePhone: str("customerServicePhone"),
  });
}
