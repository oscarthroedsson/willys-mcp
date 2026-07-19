import puppeteer from "puppeteer";
import {
  ENDPOINTS,
  LOGIN_SELECTORS,
  LOGIN_TIMING,
  PUPPETEER_ARGS,
} from "../src/constants/index.js";

/** Stop guessing. Look at the actual form. */

async function main() {
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

  // Give the SPA time to hydrate before inspecting.
  await new Promise((r) => setTimeout(r, 4_000));

  const dump = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
      name: i.name || null,
      id: i.id || null,
      type: i.type,
      placeholder: i.placeholder || null,
      visible: i.offsetParent !== null,
      ariaLabel: i.getAttribute("aria-label"),
    }));

    const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
      action: f.getAttribute("action"),
      method: f.getAttribute("method"),
      id: f.id || null,
    }));

    const buttons = Array.from(document.querySelectorAll("button"))
      .map((b) => ({
        text: (b.textContent ?? "").trim().slice(0, 40),
        type: b.getAttribute("type"),
        disabled: b.disabled,
        visible: b.offsetParent !== null,
      }))
      .filter((b) => b.text && b.visible);

    return { inputs, forms, buttons: buttons.slice(0, 12) };
  });

  console.log("=== INPUTS ===");
  for (const i of dump.inputs) console.log(JSON.stringify(i));
  console.log("\n=== FORMS ===");
  for (const f of dump.forms) console.log(JSON.stringify(f));
  console.log("\n=== SYNLIGA KNAPPAR ===");
  for (const b of dump.buttons) console.log(JSON.stringify(b));

  console.log("\n=== VAD MINA SELEKTORER TRÄFFAR ===");
  for (const [label, sel] of [
    ["username", LOGIN_SELECTORS.username],
    ["password", LOGIN_SELECTORS.password],
  ] as const) {
    const hit = await page.evaluate((s: string) => {
      const el = document.querySelector(s) as HTMLInputElement | null;
      return el
        ? { name: el.name, type: el.type, placeholder: el.placeholder, visible: el.offsetParent !== null }
        : null;
    }, sel);
    console.log(`${label}: ${JSON.stringify(hit)}`);
  }

  await browser.close();
  console.log("\nDOM_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
