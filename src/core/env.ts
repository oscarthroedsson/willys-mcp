import { readFileSync } from "node:fs";
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

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const file = process.env.WILLYS_ENV_FILE ?? path.join(PROJECT_ROOT, ".env");

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    log.debug(`ingen .env hittad på ${file} (använder processens miljö)`);
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

    // A real environment variable outranks the file.
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied++;
    }
  }

  log.info(`.env läst: ${applied} variabler från ${file}`);
}
