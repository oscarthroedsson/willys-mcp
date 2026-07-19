import puppeteer, { type Browser } from "puppeteer";
import { HEADLESS } from "../config.js";
import {
  BASE,
  ENDPOINTS,
  LOGIN_BUTTON_TEXT,
  LOGIN_SELECTORS,
  LOGIN_TIMING,
  MAX_ERROR_TEXT_LENGTH,
  MAX_ERRORS_CAPTURED,
  PUPPETEER_ARGS,
  REQUIRED_COOKIE,
  USER_AGENT,
  USERNAME_PATTERN,
  VIEWPORT,
} from "../constants/index.js";
import { loadEnv } from "../core/env.js";
import { request } from "../core/http.js";
import { log } from "../core/logger.js";
import { err, ok, type Result } from "../core/result.js";
import { keepFunctional } from "./session.js";

/**
 * The ONLY browser-dependent code in this server.
 *
 * Puppeteer exists solely to harvest session cookies from the login form.
 * Everything downstream is plain HTTP until the session expires.
 */

export interface Credentials {
  username: string;
  password: string;
}

/**
 * Credentials come from the environment (.env or real env vars), never from a
 * file this code parses ad hoc. Real environment variables win, so CI and
 * containers can override without touching disk.
 */
export function readCredentials(): Result<Credentials> {
  loadEnv();

  const username = process.env.WILLYS_USERNAME?.trim();
  const password = process.env.WILLYS_PASSWORD?.trim();

  if (!username || !password) {
    return err(
      "INPUT",
      "WILLYS_USERNAME och WILLYS_PASSWORD saknas. Kopiera .env.example " +
        "till .env och fyll i dem (chmod 600 .env).",
    );
  }

  // Verified empirically: 10 digits (ååmmddxxxx) is accepted by Willys even
  // though the form's own error text asks for ååååmmddxxxx. 12 digits and the
  // 16-digit Willys Plus number also work. Only reject what is clearly wrong —
  // an e-mail address, which the form silently refuses to submit, producing a
  // misleading 401 from an unrelated endpoint further downstream.
  if (!USERNAME_PATTERN.test(username)) {
    return err(
      "INPUT",
      `WILLYS_USERNAME måste vara personnummer (10 eller 12 siffror) eller ` +
        `Willys Plus-nummer (16 siffror). Fick ${username.length} tecken. ` +
        `E-postadress fungerar inte — formuläret skickas aldrig.`,
    );
  }

  return ok({ username, password });
}

/**
 * Prove the harvested session is actually signed in.
 *
 * /account/orders answers 200 for an authenticated user and 401 otherwise,
 * which makes it a cheap, unambiguous oracle. This check is the difference
 * between a login tool that works and one that lies.
 *
 * Used in two places: after a fresh login, and before handing back a stored
 * session. Our 24h TTL is our own bookkeeping — Willys expires sessions on its
 * own schedule, so a row that looks alive locally can already be anonymous
 * upstream.
 */
export async function verifySession(cookies: string): Promise<Result<true>> {
  const res = await request<unknown>(ENDPOINTS.orders, { cookies });
  if (res.ok) return ok(true);

  if (res.kind === "AUTH_EXPIRED") {
    return err(
      "INPUT",
      "Inloggningen gick inte igenom — sessionen är anonym. " +
        "Kontrollera WILLYS_USERNAME och WILLYS_PASSWORD i .env.",
    );
  }
  return err(res.kind, `Kunde inte verifiera inloggningen: ${res.message}`);
}

export async function harvestCookies(
  creds: Credentials,
): Promise<Result<string>> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      args: [...PUPPETEER_ARGS],
    });
    const page = await browser.newPage();

    // Without an explicit user agent Puppeteer announces "HeadlessChrome",
    // which Willys' frontend treats as automation: the login form fills in
    // correctly, the button clicks, and the submit handler then does nothing
    // at all — no request, no error message. Reusing the same UA string the
    // HTTP layer sends keeps browser and fetch consistent.
    await page.setUserAgent(USER_AGENT);
    await page.setViewport(VIEWPORT);

    await page.goto(ENDPOINTS.loginPage, {
      waitUntil: "networkidle0",
      timeout: LOGIN_TIMING.navigationTimeoutMs,
    });

    // Consent banner. Declining non-essential is not offered as a single
    // control here; accepting is required to reach the form at all.
    await new Promise((r) => setTimeout(r, LOGIN_TIMING.beforeFormMs));
    const consent = await page.$(LOGIN_SELECTORS.consentButton);
    if (consent) {
      await consent.click();
      await new Promise((r) => setTimeout(r, LOGIN_TIMING.afterConsentMs));
    }

    // Wait for the form to exist before reaching for it; the page hydrates
    // asynchronously and grabbing the inputs too early yields nulls.
    await page
      .waitForSelector(LOGIN_SELECTORS.password, { timeout: 10_000 })
      .catch(() => undefined);

    const user = await page.$(LOGIN_SELECTORS.username);
    const pass = await page.$(LOGIN_SELECTORS.password);
    if (!user || !pass) {
      return err("SHAPE", "Inloggningsformuläret hittades inte");
    }

    await user.type(creds.username, { delay: LOGIN_TIMING.typeDelayMs });
    await pass.type(creds.password, { delay: LOGIN_TIMING.typeDelayMs });

    // Native Puppeteer click, NOT element.click() inside page.evaluate().
    // The DOM click dispatches an untrusted event; Willys' submit handler
    // ignores it silently — form stays put, no request, no error.
    const buttons = await page.$$("button");
    let clicked = false;
    for (const b of buttons) {
      const label = (await b.evaluate((e) => e.textContent ?? "")).trim();
      if (label.toLowerCase() === LOGIN_BUTTON_TEXT) {
        await b.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      // Fallback: submit by pressing Enter in the password field.
      await page.focus(LOGIN_SELECTORS.password);
      await page.keyboard.press("Enter");
    }

    await new Promise((r) => setTimeout(r, LOGIN_TIMING.afterSubmitMs));

    // Capture page state BEFORE validating. The previous implementation
    // validated first and threw, discarding the only evidence of what went
    // wrong — which hid a client-side validation error behind a 401.
    const state = await page.evaluate(
      (sel: { stillOnForm: string; errorMessages: string }, maxLen: number, maxCount: number) => ({
        stillOnForm: !!document.querySelector(sel.stillOnForm),
        errors: Array.from(document.querySelectorAll(sel.errorMessages))
          .map((n) => (n as HTMLElement).innerText?.trim())
          .filter((t) => t && t.length < maxLen)
          .slice(0, maxCount),
      }),
      { stillOnForm: LOGIN_SELECTORS.stillOnForm, errorMessages: LOGIN_SELECTORS.errorMessages },
      MAX_ERROR_TEXT_LENGTH,
      MAX_ERRORS_CAPTURED,
    );

    const raw = await page.cookies(BASE);
    const jar: Record<string, string> = {};
    for (const c of raw) jar[c.name] = c.value;
    const cookies = keepFunctional(jar);

    if (state.stillOnForm && state.errors.length > 0) {
      return err(
        "INPUT",
        `Willys avvisade inloggningen: ${state.errors.join(" | ")}`,
      );
    }
    if (!cookies.includes(REQUIRED_COOKIE)) {
      return err("SHAPE", "Ingen JSESSIONID i cookie-jar efter inloggning");
    }

    log.info(`skördade ${Object.keys(jar).length} cookies, behöll funktionella`);

    // Cookie presence is NOT proof of login. JSESSIONID exists for anonymous
    // visitors too, so checking only for it makes this function report success
    // on a session that is not signed in — search and cart still work, but
    // orders and customer data come back anonymous. Only an authenticated
    // endpoint can settle it.
    const verified = await verifySession(cookies);
    if (!verified.ok) return verified;

    return ok(cookies);
  } catch (e) {
    return err("NETWORK", e instanceof Error ? e.message : String(e));
  } finally {
    await browser?.close();
  }
}
