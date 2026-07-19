/**
 * DOM selectors for the login page — the most fragile surface in the system.
 *
 * These break whenever Willys ships a frontend change, and the failure is
 * silent: the form simply never submits. Centralising them means a DOM change
 * is a one-file fix rather than a hunt through the auth flow.
 */

export const LOGIN_SELECTORS = {
  /** `j_username`/`j_password` are Spring Security's classic form-login names. */
  username: 'input[name="j_username"], input[type="text"]',
  password: 'input[name="j_password"], input[type="password"]',
  consentButton: 'button[id*="accept"]',
  /** Any surviving password field means the form did not submit. */
  stillOnForm: 'input[type="password"]',
  errorMessages: '[class*="error"],[role="alert"]',
} as const;

/** Matched case-insensitively against trimmed button text. */
export const LOGIN_BUTTON_TEXT = "logga in";

export const LOGIN_TIMING = {
  navigationTimeoutMs: 30_000,
  afterConsentMs: 1_500,
  beforeFormMs: 2_000,
  afterSubmitMs: 6_000,
  typeDelayMs: 30,
} as const;

/**
 * Launch flags. `--window-size` is load-bearing, not cosmetic: Puppeteer's
 * default 800x600 viewport makes Willys render a different layout, and the
 * login submit handler then fails silently.
 */
export const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--window-size=1920,1080",
] as const;

export const VIEWPORT = { width: 1920, height: 1080 } as const;

/** Cap on captured error text, so a broken page cannot flood the logs. */
export const MAX_ERROR_TEXT_LENGTH = 300;
export const MAX_ERRORS_CAPTURED = 5;
