import { ACCEPT_LANGUAGE, COOP, TIMING, USER_AGENT } from "../../constants/index.js";
import { log } from "../../core/logger.js";
import { err, ok, type Result } from "../../core/result.js";

/**
 * Coop's Azure APIM subscription keys, read lazily from coop.se.
 *
 * The storefront ships its keys in plain text in the page HTML (`coopSettings`)
 * so the visitor's browser can call the APIs — anyone opening coop.se receives
 * them. Verified 2026-10-13: a plain fetch, not even with a User-Agent, returns
 * 200 with all three in the body. No browser and no DOM needed; a regex on the
 * text is enough.
 *
 * They are never hardcoded, written to disk or logged. Coop can rotate them
 * like a Next.js build hash rotates; reading them at runtime turns a rotation
 * into one extra page fetch instead of a broken release.
 */

export type CoopKeyName = "personalization" | "hybris" | "store";

const FIELD: Record<CoopKeyName, string> = {
  personalization: "personalizationApiSubscriptionKey",
  hybris: "hybrisApiSubscriptionKey",
  store: "storeApiSubscriptionKey",
};

let cached: Record<CoopKeyName, string> | null = null;
let inflight: Promise<Result<Record<CoopKeyName, string>>> | null = null;

/** Pull the three keys out of the page text. Exported for the offline test. */
export function extractKeys(html: string): Record<CoopKeyName, string> | null {
  const out: Partial<Record<CoopKeyName, string>> = {};
  for (const [name, field] of Object.entries(FIELD) as [CoopKeyName, string][]) {
    const m = new RegExp(`"${field}"\\s*:\\s*"([0-9a-f]{32})"`).exec(html);
    if (!m?.[1]) return null;
    out[name] = m[1];
  }
  return out as Record<CoopKeyName, string>;
}

async function fetchKeys(): Promise<Result<Record<CoopKeyName, string>>> {
  let html: string;
  try {
    const res = await fetch(COOP.keyPage, {
      headers: { "user-agent": USER_AGENT, "accept-language": ACCEPT_LANGUAGE },
      signal: AbortSignal.timeout(TIMING.requestTimeoutMs),
    });
    if (!res.ok) return err("UPSTREAM", `coop.se svarade ${res.status} när nycklarna hämtades`, res.status);
    html = await res.text();
  } catch (e) {
    return err("NETWORK", e instanceof Error ? e.message : String(e));
  }

  const keys = extractKeys(html);
  if (!keys) {
    return err(
      "SHAPE",
      "Hittade inte Coops API-nycklar i coop.se. Coop har ändrat sidan; adaptern behöver uppdateras.",
    );
  }
  log.info("coop: API-nycklar hämtade från coop.se");
  return ok(keys);
}

/** The key for one API, fetching the page once per process (or after a rotation). */
export async function coopKey(name: CoopKeyName): Promise<Result<string>> {
  if (cached) return ok(cached[name]);
  // One fetch even when several tool calls race to be first.
  inflight ??= fetchKeys().finally(() => {
    inflight = null;
  });
  const r = await inflight;
  if (!r.ok) return r;
  cached = r.data;
  return ok(r.data[name]);
}

/** Drop the cached keys after a 401/403, so the next call reads them again. */
export function invalidateKeys(): void {
  cached = null;
}
