import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DB_PATH } from "../config.js";
import {
  FUNCTIONAL_COOKIES,
  SESSION_TTL_MS,
} from "../constants/index.js";
import { log } from "../core/logger.js";

/**
 * Session storage. One table, one job.
 *
 * The previous implementation buried a 95-line session store inside a
 * 1367-line class that also owned order caching, relational product storage
 * and vector search.
 */

interface Row {
  id: string;
  cookies: string;
  created_at: number;
  expires_at: number;
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

export function createSession(cookies: string): string {
  const id = randomUUID();
  const now = Date.now();
  conn()
    .prepare(
      "INSERT INTO sessions (id, cookies, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, cookies, now, now + SESSION_TTL_MS);
  log.info(`session skapad: ${id}`);
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
export function findValidSession(): { id: string; cookies: string } | null {
  const row = conn()
    .prepare(
      "SELECT id, cookies FROM sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(Date.now()) as { id: string; cookies: string } | undefined;
  return row ?? null;
}

export function getCookies(sessionId: string): string | null {
  const row = conn()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId) as Row | undefined;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(sessionId);
    log.info(`session utgången: ${sessionId}`);
    return null;
  }
  return row.cookies;
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
