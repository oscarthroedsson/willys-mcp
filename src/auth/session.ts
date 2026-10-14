import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DB_PATH } from "../config.js";
import {
  FUNCTIONAL_COOKIES,
  SESSION_TTL_MS,
} from "../constants/index.js";
import { log } from "../core/logger.js";
import type { ChainId } from "../chains/types.js";

/**
 * Session storage. One table, one job.
 *
 * The previous implementation buried a 95-line session store inside a
 * 1367-line class that also owned order caching, relational product storage
 * and vector search.
 */

interface Row {
  id: string;
  chain: ChainId;
  cookies: string;
  created_at: number;
  expires_at: number;
}

/** A live session: whose cookies, for which chain. */
export interface Session {
  id: string;
  chain: ChainId;
  cookies: string;
}

let db: Database.Database | null = null;

function conn(): Database.Database {
  if (db) return db;
  log.info(`öppnar databas: ${DB_PATH}`);
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      cookies    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
  // Sessions became per chain in 2.0.0. Rows from before were all Willys.
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "chain")) {
    db.exec("ALTER TABLE sessions ADD COLUMN chain TEXT NOT NULL DEFAULT 'willys'");
  }
  return db;
}

/**
 * Willys sets 21 cookies; only four carry authentication. Dropping the other
 * 17 (Hotjar, GA, Clarity, Optanon) removes ~1.6 KB from every single request
 * and keeps analytics identifiers out of the stored session.
 */
export function keepFunctional(all: Record<string, string>): string {
  const kept = Object.entries(all).filter(([name]) =>
    (FUNCTIONAL_COOKIES as readonly string[]).includes(name),
  );
  const missing = FUNCTIONAL_COOKIES.filter((c: string) => !(c in all));
  if (missing.length > 0) log.warn("saknade auth-cookies", missing);
  return kept.map(([k, v]) => `${k}=${v}`).join("; ");
}

export function createSession(cookies: string, chain: ChainId = "willys"): string {
  const id = randomUUID();
  const now = Date.now();
  conn()
    .prepare(
      "INSERT INTO sessions (id, chain, cookies, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, chain, cookies, now, now + SESSION_TTL_MS);
  log.info(`session skapad: ${id} (${chain})`);
  return id;
}

/**
 * Newest session that is still valid, if any.
 *
 * Logging in costs a Puppeteer run and, more importantly, an authentication
 * attempt against Willys — which throttles after repeated logins. Sessions last
 * 24 hours, so re-using one is both faster and the difference between working
 * and being locked out.
 */
export function findValidSession(chain: ChainId = "willys"): Session | null {
  const row = conn()
    .prepare(
      "SELECT id, chain, cookies FROM sessions WHERE chain = ? AND expires_at > ? " +
        "ORDER BY created_at DESC LIMIT 1",
    )
    .get(chain, Date.now()) as Session | undefined;
  return row ?? null;
}

/** The live session for an id, or null when unknown or expired. */
export function getSession(sessionId: string): Session | null {
  const row = conn()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId) as Row | undefined;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(sessionId);
    log.info(`session utgången: ${sessionId}`);
    return null;
  }
  return { id: row.id, chain: row.chain, cookies: row.cookies };
}

/** Cookies only — for callers that already know which chain the session is for. */
export function getCookies(sessionId: string): string | null {
  return getSession(sessionId)?.cookies ?? null;
}

export function deleteSession(sessionId: string): void {
  conn().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function purgeExpired(): number {
  const r = conn()
    .prepare("DELETE FROM sessions WHERE expires_at < ?")
    .run(Date.now());
  return r.changes;
}
