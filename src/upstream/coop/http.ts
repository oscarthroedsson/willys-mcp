import { request } from "../../core/http.js";
import { err, type Result } from "../../core/result.js";
import { coopKey, invalidateKeys, type CoopKeyName } from "./keys.js";

/**
 * Every Coop call: the right APIM key, a plain JSON request, and one retry
 * with a freshly read key when Coop says the key is no longer valid.
 *
 * A 401/403 here is not an expired user session — Coop's public APIs have no
 * session — so it is never reported as AUTH_EXPIRED, which would send the
 * model off to log in again for nothing.
 */
export async function coopRequest<T>(
  api: CoopKeyName,
  url: string,
  opts: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<Result<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = await coopKey(api);
    if (!key.ok) return key;

    const res = await request<T>(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      profile: "plain",
      headers: { "Ocp-Apim-Subscription-Key": key.data },
      label: "Coop",
    });
    if (res.ok || res.kind !== "AUTH_EXPIRED") return res;

    // The key was rotated (or revoked) since we read it. Read it again, once.
    invalidateKeys();
  }
  return err(
    "UPSTREAM",
    "Coop avvisade API-nyckeln även efter att den hämtats om från coop.se.",
    401,
  );
}
