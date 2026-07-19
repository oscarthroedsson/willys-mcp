import { ENDPOINTS } from "../constants/index.js";
import { request } from "../core/http.js";
import { ok, type Result } from "../core/result.js";
import { parse } from "./parse.js";
import { UpstreamCustomer } from "./schemas.js";

export interface CustomerProfile {
  id: string | null;
  name: string | null;
}

/**
 * Customer profile.
 *
 * Doubles as the session probe in `auth/login.ts`: an expired session answers
 * this route as an anonymous user rather than failing outright, so the presence
 * of a uid is what actually proves the cookies are live.
 */
export async function getCustomer(
  cookies: string,
): Promise<Result<CustomerProfile>> {
  const res = await request(ENDPOINTS.customer, { cookies });
  if (!res.ok) return res;

  const parsed = parse(UpstreamCustomer, res.data);
  if (!parsed.ok) return parsed;

  const c = parsed.data;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return ok({ id: c.uid ?? null, name: name || null });
}
