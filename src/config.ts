import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Runtime configuration: filesystem paths and environment overrides only.
 * Everything encoding Willys' API contract lives in ./constants.
 */

/**
 * Project root, anchored to THIS FILE — never to process.cwd().
 *
 * The MCP client spawns this server with an arbitrary working directory. A
 * cwd-relative path silently creates a second database, and sessions written
 * by one process become invisible to the other. That bug cost real debugging
 * time in the previous implementation; it is structurally impossible here,
 * and it survived moving the whole project between directories unchanged.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, "..");

export const DB_PATH =
  process.env.WILLYS_DB_PATH ?? path.join(PROJECT_ROOT, "willys.db");

/** Set in .env; look one up with willys_find_stores. */
export const DEFAULT_STORE_ID = () => process.env.WILLYS_STORE_ID ?? null;

/** Set WILLYS_HEADFUL=1 to watch the login flow in a real browser window. */
export const HEADLESS = process.env.WILLYS_HEADFUL !== "1";
