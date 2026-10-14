import {
  ACCEPT_LANGUAGE,
  axfoodEndpoints,
  TIMING,
  USER_AGENT,
  type AxfoodSite,
} from "../../constants/index.js";
import { log } from "../../core/logger.js";
import { err, ok, type Result } from "../../core/result.js";

/**
 * An anonymous Axfood session pinned to one store.
 *
 * Axfood prices are per store. Without a session every public call answers
 * with the site's default store (Hemköp 4003). The storefront pins a store with
 * `POST /axfood/rest/store/activate` — verified 2026-10-14 anonymously: after
 * activating Hemköp 4146 the same mellanmjölk went from 17,45 to 17,88 kr.
 *
 * Only for anonymous calls. Activating a store on a logged-in session changes
 * which store the user's own cart is picked from — a side effect the server
 * must never take silently.
 */

/** Long enough to cover a planning session, short enough to outlive no JSESSIONID. */
const TTL_MS = 20 * 60 * 1000;

const cache = new Map<string, { cookies: string; expires: number }>();

/** Fold Set-Cookie headers into a jar, keeping only name=value. */
function absorb(jar: Map<string, string>, res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

const serialise = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function call(
  url: string,
  jar: Map<string, string>,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/json",
      "accept-language": ACCEPT_LANGUAGE,
      "user-agent": USER_AGENT,
      cookie: serialise(jar),
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMING.requestTimeoutMs),
  });
  absorb(jar, res);
  return res;
}

export async function storeCookies(
  site: AxfoodSite,
  storeId: string,
): Promise<Result<string>> {
  const key = `${site.chain}:${storeId}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return ok(hit.cookies);

  const ep = axfoodEndpoints(site);
  const jar = new Map<string, string>();
  try {
    const csrfRes = await call(ep.csrf, jar);
    const token = csrfRes.ok ? String(await csrfRes.json()) : "";
    if (!token) return err("UPSTREAM", `${site.label} gav ingen CSRF-token (${csrfRes.status})`);

    const activate = await call(
      `${site.base}/axfood/rest/store/activate?storeId=${encodeURIComponent(storeId)}` +
        "&activelySelected=true&forceAsPickingStore=true",
      jar,
      { method: "POST", headers: { "x-csrf-token": token, "content-type": "application/json" } },
    );
    if (!activate.ok) {
      return err(
        activate.status === 400 || activate.status === 404 ? "NOT_FOUND" : "UPSTREAM",
        `${site.label} kunde inte välja butik ${storeId} (${activate.status}). Slå upp ett giltigt butiks-id.`,
        activate.status,
      );
    }
  } catch (e) {
    return err("NETWORK", e instanceof Error ? e.message : String(e));
  }

  const cookies = serialise(jar);
  cache.set(key, { cookies, expires: Date.now() + TTL_MS });
  log.debug(`anonym session för ${key}`);
  return ok(cookies);
}
