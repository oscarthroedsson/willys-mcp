import puppeteer from "puppeteer";
import { readCredentials } from "../src/auth/login.js";
import {
  BASE,
  ENDPOINTS,
  LOGIN_SELECTORS,
  LOGIN_TIMING,
  PUPPETEER_ARGS,
} from "../src/constants/index.js";
import { apiHeaders } from "../src/core/http.js";

/** Does React actually receive the typed values, and does settle time matter? */

async function run(settleMs: number, username: string, password: string) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [...PUPPETEER_ARGS],
  });
  try {
    const page = await browser.newPage();
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

    // The variable under test.
    await new Promise((r) => setTimeout(r, settleMs));

    await page.waitForSelector('input[name="j_username"]', { timeout: 10_000 });
    const u = await page.$('input[name="j_username"]');
    const p = await page.$('input[name="j_password"]');
    if (!u || !p) return { settleMs, error: "fält saknas" };

    await u.click();
    await u.type(username, { delay: 50 });
    await p.click();
    await p.type(password, { delay: 50 });

    // Read back what the DOM holds after typing.
    const values = await page.evaluate(() => {
      const un = document.querySelector(
        'input[name="j_username"]',
      ) as HTMLInputElement | null;
      const pw = document.querySelector(
        'input[name="j_password"]',
      ) as HTMLInputElement | null;
      return { userLen: un?.value.length ?? -1, passLen: pw?.value.length ?? -1 };
    });

    const authCalls: string[] = [];
    page.on("response", (r) => {
      if (/login|authenticate|j_spring|j_security/i.test(r.url())) {
        authCalls.push(`${r.status()} ${r.url().slice(0, 70)}`);
      }
    });

    const btn = await page.$('button[type="submit"]');
    if (!btn) return { settleMs, values, error: "submit-knapp saknas" };
    await btn.click();

    await new Promise((r) => setTimeout(r, 8_000));

    const after = await page.evaluate(() => ({
      stillOnForm: !!document.querySelector('input[type="password"]'),
      errors: Array.from(
        document.querySelectorAll('[class*="error"],[role="alert"]'),
      )
        .map((n) => (n as HTMLElement).innerText?.trim())
        .filter((t) => t && t.length < 200)
        .slice(0, 3),
    }));

    const raw = await page.cookies(BASE);
    const jar = raw.map((c) => `${c.name}=${c.value}`).join("; ");
    const status = (await fetch(ENDPOINTS.orders, { headers: apiHeaders(jar) }))
      .status;

    return {
      settleMs,
      values,
      authCalls,
      stillOnForm: after.stillOnForm,
      errors: after.errors,
      hasRememberMe: raw.some((c) => c.name === "axfoodRememberMe"),
      ordersStatus: status,
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
  console.log(`användarnamn: ${username.length} tecken, lösenord: ${password.length} tecken\n`);

  for (const settle of [0, 6_000]) {
    const r = await run(settle, username, password);
    console.log(`=== SETTLE ${settle}ms ===`);
    console.log(JSON.stringify(r, null, 2));
    console.log();
  }
  console.log("HYDRATION_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
