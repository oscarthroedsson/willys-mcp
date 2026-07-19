/**
 * Willys sets 21 cookies; only these four carry authentication.
 *
 * Dropping the other 17 (Hotjar, GA, Clarity, Optanon, session-init counters)
 * shrinks the stored session from 2188 to 269 characters — measured — removes
 * ~1.6 KB from every request, and keeps analytics identifiers out of our
 * database.
 */
export const FUNCTIONAL_COOKIES = [
  "JSESSIONID",
  "axfoodRememberMe",
  "__Host-csrf-token",
  "ROUTE",
] as const;

/** Without this one there is no authenticated session at all. */
export const REQUIRED_COOKIE = "JSESSIONID";

/**
 * axfoodRememberMe carries an embedded expiry (observed: ~2026-10-10),
 * suggesting sessions may outlive the 24h TTL we currently assume. Worth
 * measuring before shortening or lengthening SESSION_TTL_MS.
 */
export const REMEMBER_ME_COOKIE = "axfoodRememberMe";
