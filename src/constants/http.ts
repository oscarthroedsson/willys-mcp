/**
 * Browser fingerprint. Willys' edge degrades or rejects requests that do not
 * look like a real Chrome session, so these are load-bearing — not cosmetic.
 * The version numbers in USER_AGENT and SEC_CH_UA must stay in sync.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

export const SEC_CH_UA =
  '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"';

export const ACCEPT_LANGUAGE =
  "sv-SE,sv;q=0.9,en-US;q=0.8,en-SE;q=0.7,en-GB;q=0.6,en;q=0.5";

/** NewRelic browser-agent identifiers, read from Willys' own page scripts. */
export const NEWRELIC = {
  accountId: "1154196",
  appId: "772324203",
} as const;

/**
 * Tuned for an interactive tool, not a batch job. The old 30s × 4 attempts made
 * a single wedged request hang 2–4 minutes — long enough that the client gave
 * up and the model burned the wait. A healthy Willys answers in well under a
 * second, so a 12s ceiling and one retry fail fast without tripping on normal
 * latency. Worst case is now ~25s instead of ~127s.
 */
export const TIMING = {
  requestTimeoutMs: 12_000,
  maxRetries: 1,
  baseDelayMs: 500,
  maxBackoffMs: 2_000,
} as const;

/** Named so retry/auth logic reads as intent rather than as numbers. */
export const STATUS = {
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  tooManyRequests: 429,
  serverError: 500,
} as const;

export const JSON_CONTENT_TYPE = "application/json";
