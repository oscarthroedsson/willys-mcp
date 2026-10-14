import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Runtime configuration: filesystem paths and environment overrides only.
 * Everything encoding Willys' API contract lives in ./constants.
 */

/**
 * Where the shipped files live — docs/ and .env.example. Anchored to THIS FILE,
 * never to process.cwd(): the MCP client spawns the server with an arbitrary
 * working directory, and a cwd-relative path silently resolves somewhere else.
 *
 * Read-only. Installed from npm this is inside node_modules, which npm replaces
 * wholesale on every update — nothing the user owns may live here.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(HERE, "..");

/**
 * True in a source checkout. src/ is excluded from the published package, so
 * its presence is the one signal that distinguishes "cloned repo" from
 * "installed dependency" without asking the user to configure anything.
 */
const IS_CHECKOUT = existsSync(path.join(PACKAGE_ROOT, "src"));

/**
 * Where the user's own state lives: .env and the session database.
 *
 * In a checkout that is the project root, which is what every existing install
 * already expects. Installed from npm it is ~/.willys-mcp, because the package
 * directory is npm's to delete: writing credentials there means `npm update`
 * throws away the password and every stored session, and a global install may
 * not even be writable by the user running the server.
 */
export const STATE_DIR = resolveStateDir();

function resolveStateDir(): string {
  if (process.env.WILLYS_HOME) return path.resolve(process.env.WILLYS_HOME);
  if (IS_CHECKOUT) return PACKAGE_ROOT;

  const dir = path.join(homedir(), ".willys-mcp");
  try {
    // 0700: the directory holds a personnummer and live session cookies.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // Reported properly by the database check in setup.ts; failing at import
    // time would take the whole server down before it can explain why.
  }
  return dir;
}

/** The .env the user fills in. Created by setup_init. */
export const ENV_FILE = (): string =>
  process.env.WILLYS_ENV_FILE ?? path.join(STATE_DIR, ".env");

/** Template shipped with the package, copied into place on first run. */
export const ENV_TEMPLATE = path.join(PACKAGE_ROOT, ".env.example");

export const DB_PATH =
  process.env.WILLYS_DB_PATH ?? path.join(STATE_DIR, "willys.db");

/** Set in .env; look one up with find_stores (chain "willys"). */
export const DEFAULT_STORE_ID = () => process.env.WILLYS_STORE_ID ?? null;

/** Set WILLYS_HEADFUL=1 to watch the login flow in a real browser window. */
export const HEADLESS = process.env.WILLYS_HEADFUL !== "1";
