import puppeteer, { type Page } from "puppeteer";
import { readCredentials } from "../src/auth/login.js";
import {
  BASE,
  ENDPOINTS,
  LOGIN_BUTTON_TEXT,
  LOGIN_SELECTORS,
  LOGIN_TIMING,
  PUPPETEER_ARGS,
} from "../src/constants/index.js";
import { apiHeaders } from "../src/core/http.js";

/** Does the click method decide whether the form actually submits? */

async function attempt(
  mode: "evaluate" | "native",
  username: string,
  password: string,
) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [...PUPPETEER_ARGS],
  });
  try {
    const page: Page = await browser.newPage();
    await page.goto(ENDPOINTS.loginPage, {
      waitUntil: "networkidle0",
      timeout: LOGIN_TIMING.navigationTimeoutMs,
    });
    await new Promise((r) => setTimeout(r, LOGIN_TIMING.beforeFormMs));

    const consent = await page.$(LOGIN_SELECTORS.consentButton);
    if (consent) {
      await consent.click();
      await new Promise((r) => setTimeout(r, LOGIN_TIMING.afterConsentMs));
    }

    const u = await page.$(LOGIN_SELECTORS.username);
    const p = await page.$(LOGIN_SELECTORS.password);
    if (!u || !p) return { mode, error: "formulär saknas" };

    await u.type(username, { delay: LOGIN_TIMING.typeDelayMs });
    await p.type(password, { delay: LOGIN_TIMING.typeDelayMs });

    const authCalls: string[] = [];
    page.on("response", (r) => {
      if (/login|authenticate|j_spring|j_security/i.test(r.url())) {
        authCalls.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 90)}`);
      }
    });

    if (mode === "evaluate") {
      await page.evaluate((label: string) => {
        const b = Array.from(document.querySelectorAll("button")).find(
          (x) => (x.textContent ?? "").trim().toLowerCase() === label,
        );
        b?.click();
      }, LOGIN_BUTTON_TEXT);
    } else {
      // Native Puppeteer click: synthesised trusted mouse events at real
      // coordinates, which is what the previous working implementation used.
      const buttons = await page.$$("button");
      let clicked = false;
      for (const b of buttons) {
        const t = (await b.evaluate((e) => e.textContent ?? "")).trim();
        if (t.toLowerCase() === LOGIN_BUTTON_TEXT) {
          await b.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) return { mode, error: "knapp saknas" };
    }

    await new Promise((r) => setTimeout(r, 8_000));

    const raw = await page.cookies(BASE);
    const names = raw.map((c) => c.name);
    const cookieStr = raw.map((c) => `${c.name}=${c.value}`).join("; ");
    const status = (
      await fetch(ENDPOINTS.orders, { headers: apiHeaders(cookieStr) })
    ).status;

    const pageState = await page.evaluate((sel: string) => ({
      stillOnForm: !!document.querySelector(sel),
      url: location.href,
    }), LOGIN_SELECTORS.stillOnForm);

    return {
      mode,
      ordersStatus: status,
      hasRememberMe: names.includes("axfoodRememberMe"),
      cookieCount: names.length,
      stillOnForm: pageState.stillOnForm,
      url: pageState.url,
      authCalls,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const creds = readCredentials();
  if (!creds.ok) {
    console.log("CREDS_FEL", creds.message);
    process.exit(1);
  }
  const { username, password } = creds.data;

  for (const mode of ["evaluate", "native"] as const) {
    const r = await attempt(mode, username, password);
    console.log(`\n=== ${mode.toUpperCase()} ===`);
    console.log(JSON.stringify(r, null, 2));
  }
  console.log("\nCOMPARE_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
