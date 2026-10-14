import { CITYGROSS } from "../../constants/index.js";
import { request } from "../../core/http.js";
import type { Result } from "../../core/result.js";

/** Every City Gross call: plain JSON against their API, no key, no session. */
export function cgGet<T>(path: string): Promise<Result<T>> {
  return request<T>(`${CITYGROSS.api}${path}`, { profile: "plain", label: "City Gross" });
}

/** `store=` is sent empty when no store is chosen, as the storefront does. */
export const storeParam = (storeId: string | undefined) =>
  `store=${encodeURIComponent(storeId ?? "")}`;
