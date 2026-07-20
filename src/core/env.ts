import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../config.js";
import { log } from "./logger.js";

/**
 * Minimal .env loader.
 *
 * Deliberately dependency-free: dotenv brings a package and a maintenance
 * surface for roughly twenty lines of parsing. Real environment variables
 * always win over the file, so containers and CI can override without editing
 * anything on disk.
 */

/** Modification time of the .env we last read, so edits are picked up. */
let loadedMtimeMs: number | null = null;

/** Keys this loader set. Only these may be overwritten on a reload. */
const fromFile = new Set<string>();

/**
 * Read .env, re-reading whenever the file has changed on disk.
 *
 * Loading once at startup meant filling in credentials required restarting the
 * whole MCP server from the client — the last piece of friction in a setup flow
 * built to have none. Keying on mtime makes an edit take effect on the next
 * tool call instead.
 *
 * Values that came from the real process environment are never overwritten:
 * only keys this loader itself set are eligible, so a container or CI override
 * still wins the way it did before.
 */
export function loadEnv(): void {
  const file = process.env.WILLYS_ENV_FILE ?? path.join(PROJECT_ROOT, ".env");

  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    if (loadedMtimeMs === null) {
      log.debug(`ingen .env hittad på ${file} (använder processens miljö)`);
      loadedMtimeMs = 0;
    }
    return;
  }

  if (loadedMtimeMs === mtimeMs) return;
  const reloading = loadedMtimeMs !== null;
  loadedMtimeMs = mtimeMs;

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    log.debug(`kunde inte läsa ${file}`);
    return;
  }

  let applied = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip a single layer of matching quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // A real environment variable outranks the file — but a value this loader
    // set previously is ours to update, which is what makes reloading work.
    if (process.env[key] === undefined || fromFile.has(key)) {
      process.env[key] = value;
      fromFile.add(key);
      applied++;
    }
  }

  log.info(
    `${reloading ? ".env omläst" : ".env läst"}: ${applied} variabler från ${file}`,
  );
}
