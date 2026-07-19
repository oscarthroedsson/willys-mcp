import { harvestCookies, readCredentials } from "../src/auth/login.js";
import { ENDPOINTS } from "../src/constants/index.js";
import { request } from "../src/core/http.js";

/** What do displayVolume / comparePrice actually look like across categories? */

const QUERIES = [
  "köttfärs",
  "kycklingfilé",
  "mjölk",
  "pasta",
  "ost",
  "gul lök",
  "grädde",
  "ägg",
];

async function main() {
  const creds = readCredentials();
  if (!creds.ok) {
    console.log("CREDS_FEL", creds.message);
    process.exit(1);
  }
  const c = await harvestCookies(creds.data);
  if (!c.ok) {
    console.log("LOGIN_FEL", c.kind, c.message);
    process.exit(1);
  }

  const volumes = new Set<string>();
  const units = new Set<string>();

  for (const q of QUERIES) {
    const url = `${ENDPOINTS.search}?q=${encodeURIComponent(q)}&page=0&size=25`;
    const r = await request<{ results?: Array<Record<string, unknown>> }>(url, {
      cookies: c.data,
    });
    if (!r.ok) continue;
    for (const p of r.data.results ?? []) {
      if (typeof p.displayVolume === "string" && p.displayVolume)
        volumes.add(p.displayVolume);
      if (typeof p.comparePriceUnit === "string" && p.comparePriceUnit)
        units.add(p.comparePriceUnit);
    }
  }

  console.log("=== displayVolume, unika format ===");
  for (const v of [...volumes].sort()) console.log(`  ${v}`);
  console.log(`\ntotalt ${volumes.size} unika`);

  console.log("\n=== comparePriceUnit ===");
  for (const u of [...units].sort()) console.log(`  ${u}`);

  console.log("\nSURVEY_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
