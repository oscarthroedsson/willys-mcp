import puppeteer from "puppeteer";
import { readCredentials } from "../src/auth/login.js";
import {
  BASE,
  ENDPOINTS,
  LOGIN_SELECTORS,
  LOGIN_TIMING,
  PUPPETEER_ARGS,
} from "../src/constants/index.js";

/**
 * Capture EVERY request made during a login attempt.
 *
 * Goal: find the real auth endpoint so login can be done with plain fetch,
 * removing the browser from the runtime path entirely.
 */

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

  const posts: string[] = [];
  const all: string[] = [];

  page.on("request", (r) => {
    const line = `${r.method()} ${r.url().slice(0, 120)}`;
    all.push(line);
    if (r.method() === "POST") {
      const data = r.postData();
      posts.push(
        `POST ${r.url()}\n     content-type: ${r.headers()["content-type"] ?? "?"}\n     body: ${
          data ? data.slice(0, 300) : "(tom)"
        }`,
      );
    }
  });

  page.on("response", (r) => {
    if (r.request().method() === "POST") {
      posts.push(`  -> ${r.status()} ${r.url().slice(0, 100)}`);
    }
  });

  await page.goto(ENDPOINTS.loginPage, {
    waitUntil: "networkidle0",
    timeout: LOGIN_TIMING.navigationTimeoutMs,
  });
  await new Promise((r) => setTimeout(r, 3_000));

  const consent = await page.$(LOGIN_SELECTORS.consentButton);
  if (consent) {
    await consent.click();
    await new Promise((r) => setTimeout(r, 2_000));
  }

  await page.waitForSelector('input[name="j_username"]', { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 3_000));

  const u = await page.$('input[name="j_username"]');
  const p = await page.$('input[name="j_password"]');
  if (!u || !p) {
    console.log("FÄLT_SAKNAS");
    process.exit(1);
  }

  await u.click();
  await u.type(creds.data.username, { delay: 60 });
  await p.click();
  await p.type(creds.data.password, { delay: 60 });

  console.log("--- markör: allt efter denna punkt är submit ---");
  const marker = all.length;

  // Mirror the old implementation: iterate buttons, native click, then fall
  // back to pressing Enter in the password field.
  const buttons = await page.$$("button");
  let clicked = false;
  for (const b of buttons) {
    const t = (await b.evaluate((e) => e.textContent ?? "")).trim();
    if (t.toLowerCase() === "logga in") {
      await b.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    await page.focus('input[name="j_password"]');
    await page.keyboard.press("Enter");
  }
  console.log(`knapp klickad: ${clicked}`);

  await new Promise((r) => setTimeout(r, 10_000));

  console.log("\n=== POST-ANROP (hela sessionen) ===");
  console.log(posts.length ? posts.join("\n") : "(inga POST alls)");

  console.log("\n=== ALLA ANROP EFTER SUBMIT ===");
  const after = all.slice(marker);
  console.log(after.length ? after.join("\n") : "(inga anrop alls efter klick)");

  const cookies = await page.cookies(BASE);
  console.log(
    `\naxfoodRememberMe: ${cookies.some((c) => c.name === "axfoodRememberMe")}`,
  );
  console.log(`url: ${page.url()}`);

  await browser.close();
  console.log("\nCAPTURE_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
