import puppeteer from "puppeteer";
import { readCredentials } from "../src/auth/login.js";
import {
  ENDPOINTS,
  BASE,
  LOGIN_SELECTORS,
  LOGIN_BUTTON_TEXT,
  LOGIN_TIMING,
  PUPPETEER_ARGS,
  FUNCTIONAL_COOKIES,
} from "../src/constants/index.js";
import { apiHeaders } from "../src/core/http.js";

/** Which cookies does an AUTHENTICATED endpoint actually require? Measure it. */

async function probe(cookies: string): Promise<number> {
  const r = await fetch(ENDPOINTS.orders, { headers: apiHeaders(cookies) });
  return r.status;
}

const str = (jar: Record<string, string>, names: string[]) =>
  names
    .filter((n) => n in jar)
    .map((n) => `${n}=${jar[n]}`)
    .join("; ");

async function main() {
  const creds = readCredentials();
  if (!creds.ok) {
    console.log("CREDS_FEL", creds.message);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [...PUPPETEER_ARGS],
  });
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
  const u = await page.$(LOGIN_SELECTORS.username);
  const p = await page.$(LOGIN_SELECTORS.password);
  if (!u || !p) {
    console.log("FORM_SAKNAS");
    process.exit(1);
  }
  await u.type(creds.data.username, { delay: LOGIN_TIMING.typeDelayMs });
  await p.type(creds.data.password, { delay: LOGIN_TIMING.typeDelayMs });
  await page.evaluate((label: string) => {
    const b = Array.from(document.querySelectorAll("button")).find(
      (x) => (x.textContent ?? "").trim().toLowerCase() === label,
    );
    b?.click();
  }, LOGIN_BUTTON_TEXT);
  await new Promise((r) => setTimeout(r, LOGIN_TIMING.afterSubmitMs));

  const raw = await page.cookies(BASE);
  await browser.close();

  const jar: Record<string, string> = {};
  for (const c of raw) jar[c.name] = c.value;
  const all = Object.keys(jar);
  console.log(`cookies efter inloggning: ${all.length}`);
  console.log(all.join(", "));

  const full = str(jar, all);
  const pruned = str(jar, [...FUNCTIONAL_COOKIES]);

  console.log(`\nALLA (${full.length} tecken)        -> ${await probe(full)}`);
  console.log(`BESKURNA (${pruned.length} tecken)    -> ${await probe(pruned)}`);

  // Add each excluded cookie to the pruned set, one at a time.
  const excluded = all.filter(
    (n) => !(FUNCTIONAL_COOKIES as readonly string[]).includes(n),
  );
  console.log("\n=== beskurna + EN extra ===");
  const winners: string[] = [];
  for (const name of excluded) {
    const s = str(jar, [...FUNCTIONAL_COOKIES, name]);
    const status = await probe(s);
    if (status === 200) winners.push(name);
    console.log(`${status}  +${name}`);
  }

  console.log(`\nTILLRÄCKLIGA TILLÄGG: ${winners.join(", ") || "(inga ensamma)"}`);

  // If no single cookie suffices, find the minimal set by removing from full.
  if (winners.length === 0) {
    console.log("\n=== tar bort en i taget från ALLA ===");
    const required: string[] = [];
    for (const name of all) {
      const s = str(jar, all.filter((n) => n !== name));
      const status = await probe(s);
      if (status !== 200) required.push(name);
      if (status !== 200) console.log(`${status}  utan ${name} <-- krävs`);
    }
    console.log(`\nKRÄVS: ${required.join(", ")}`);
  }

  console.log("\nBISECT_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
