import Database from "better-sqlite3";
import { DB_PATH } from "../config.js";
import { log } from "../core/logger.js";
import { err, ok, type Result } from "../core/result.js";
import type { ChainAdapter, ChainId, Store } from "./types.js";

/**
 * Store registry for every chain — the lookup book.
 *
 * Each adapter that has stores hands over its whole registry in one call; we
 * cache it in SQLite per chain and serve lookups locally. That turns "which
 * store am I ordering from?" from an open question into a table read.
 *
 * The cache replaces the Willys-only `stores` table, which is dropped: it was
 * a cache, refetched on first use, so nothing the user owns is lost.
 */

/** A registry older than this is refetched on the next lookup. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let db: Database.Database | null = null;

function conn(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    DROP TABLE IF EXISTS stores;
    CREATE TABLE IF NOT EXISTS chain_stores (
      chain        TEXT NOT NULL,
      storeId      TEXT NOT NULL,
      name         TEXT NOT NULL,
      street       TEXT,
      postalCode   TEXT,
      town         TEXT,
      phone        TEXT,
      lat          REAL,
      lng          REAL,
      ecommerce    INTEGER NOT NULL DEFAULT 0,
      kind         TEXT,
      openingHours TEXT,
      refreshed_at INTEGER NOT NULL,
      PRIMARY KEY (chain, storeId)
    );
    CREATE INDEX IF NOT EXISTS idx_chain_stores_town ON chain_stores(chain, town);
  `);
  return db;
}

function rowToStore(r: Record<string, unknown>): Store {
  return {
    chain: r.chain as ChainId,
    storeId: String(r.storeId),
    name: String(r.name),
    street: (r.street as string) ?? null,
    postalCode: (r.postalCode as string) ?? null,
    town: (r.town as string) ?? null,
    phone: (r.phone as string) ?? null,
    lat: (r.lat as number) ?? null,
    lng: (r.lng as number) ?? null,
    ecommerce: r.ecommerce === 1,
    kind: (r.kind as string) ?? null,
    openingHours: (r.openingHours as string) ?? null,
  };
}

/** Fetch one chain's registry and replace its rows. */
export async function refreshStores(adapter: ChainAdapter): Promise<Result<number>> {
  if (!adapter.listStores) {
    return err("INPUT", `${adapter.displayName} har inget butiksregister.`);
  }
  const r = await adapter.listStores();
  if (!r.ok) return r;

  const now = Date.now();
  const d = conn();
  const insert = d.prepare(`
    INSERT INTO chain_stores (chain,storeId,name,street,postalCode,town,phone,
                              lat,lng,ecommerce,kind,openingHours,refreshed_at)
    VALUES (@chain,@storeId,@name,@street,@postalCode,@town,@phone,
            @lat,@lng,@ecommerce,@kind,@openingHours,@now)
  `);
  d.transaction((rows: Store[]) => {
    d.prepare("DELETE FROM chain_stores WHERE chain = ?").run(adapter.id);
    for (const s of rows) insert.run({ ...s, ecommerce: s.ecommerce ? 1 : 0, now });
  })(r.data);

  log.info(`butiksregister ${adapter.id}: ${r.data.length} butiker`);
  return ok(r.data.length);
}

/** Seed or refresh on use, so lookups never return a misleading empty set. */
async function ensureFresh(adapter: ChainAdapter): Promise<Result<true>> {
  const row = conn()
    .prepare("SELECT COUNT(*) AS n, MIN(refreshed_at) AS oldest FROM chain_stores WHERE chain = ?")
    .get(adapter.id) as { n: number; oldest: number | null };
  if (row.n > 0 && row.oldest !== null && Date.now() - row.oldest < MAX_AGE_MS) {
    return ok(true);
  }
  const r = await refreshStores(adapter);
  // A stale registry beats none: keep serving it if the refresh fails.
  if (!r.ok && row.n > 0) {
    log.warn(`kunde inte förnya butiksregistret för ${adapter.id}`, r.message);
    return ok(true);
  }
  return r.ok ? ok(true) : r;
}

export async function findStores(
  adapter: ChainAdapter,
  query: string,
  onlyEcommerce: boolean,
  limit: number,
): Promise<Result<Store[]>> {
  const fresh = await ensureFresh(adapter);
  if (!fresh.ok) return fresh;

  const like = `%${query.toLowerCase()}%`;
  // Postcodes are stored as upstream writes them ("822 31"); compare without spaces.
  const digits = `%${query.replace(/\s/g, "")}%`;
  const rows = conn()
    .prepare(
      `SELECT * FROM chain_stores
       WHERE chain = ?
         AND (lower(name) LIKE ? OR lower(town) LIKE ? OR replace(postalCode,' ','') LIKE ?)
         AND (0 = ? OR ecommerce = 1)
       ORDER BY kind IS NOT NULL, name
       LIMIT ?`,
    )
    .all(adapter.id, like, like, digits, onlyEcommerce ? 1 : 0, limit) as Record<string, unknown>[];

  return ok(rows.map(rowToStore));
}

/** Haversine distance in kilometres. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
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
  adapter: ChainAdapter,
  lat: number,
  lng: number,
  onlyEcommerce: boolean,
  limit: number,
): Promise<Result<Array<Store & { distanceKm: number }>>> {
  const fresh = await ensureFresh(adapter);
  if (!fresh.ok) return fresh;

  const rows = conn()
    .prepare(
      `SELECT * FROM chain_stores
       WHERE chain = ? AND lat IS NOT NULL AND lng IS NOT NULL
         AND (0 = ? OR ecommerce = 1)`,
    )
    .all(adapter.id, onlyEcommerce ? 1 : 0) as Record<string, unknown>[];

  if (rows.length === 0) {
    return err("INPUT", `${adapter.displayName} har inga koordinater i butiksregistret; sök på ort eller namn i stället.`);
  }

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

/**
 * Whether a store id exists in the chain's registry. Unknown chains (no
 * registry) answer true — there is nothing to check against.
 */
export async function storeKnown(adapter: ChainAdapter, storeId: string): Promise<Result<boolean>> {
  if (!adapter.listStores) return ok(true);
  const fresh = await ensureFresh(adapter);
  if (!fresh.ok) return fresh;
  const row = conn()
    .prepare("SELECT 1 FROM chain_stores WHERE chain = ? AND storeId = ?")
    .get(adapter.id, storeId);
  return ok(Boolean(row));
}
