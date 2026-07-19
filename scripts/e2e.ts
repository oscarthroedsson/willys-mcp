import { harvestCookies, readCredentials } from "../src/auth/login.js";
import { createSession, getCookies } from "../src/auth/session.js";
import { search } from "../src/upstream/client.js";
import { compact, pruneProduct } from "../src/mappers/prune.js";

async function main() {
  const creds = readCredentials();
  if (!creds.ok) {
    console.log("CREDS_FEL:", creds.message);
    process.exit(1);
  }
  console.log("credentials OK, format validerat");

  const cookies = await harvestCookies(creds.data);
  if (!cookies.ok) {
    console.log("LOGIN_FEL:", cookies.kind, cookies.message);
    process.exit(1);
  }
  const id = createSession(cookies.data);
  console.log("LOGIN_OK session:", id);
  console.log("cookie-längd (beskuren):", cookies.data.length);

  const c = getCookies(id);
  if (!c) {
    console.log("SESSION_FEL");
    process.exit(1);
  }

  const r = await search(c, "kycklingfile", 0, 20);
  if (!r.ok) {
    console.log("SEARCH_FEL:", r.kind, r.message);
    process.exit(1);
  }

  const all = r.data.products;
  const swedish = all.filter((p) => p.origin === "SE");

  console.log("\n=== RESULTAT ===");
  console.log("träffar totalt:", r.data.total, "| sida", r.data.page + 1, "av", r.data.pages);
  console.log("produkter i svaret:", all.length);
  console.log("varav svenskmärkta:", swedish.length);

  const output = compact(all.map(pruneProduct));
  console.log("\n=== TOKEN-BUDGET ===");
  console.log("beskuret svar:", output.length, "tecken");
  console.log("per produkt:", Math.round(output.length / Math.max(all.length, 1)));
  console.log("rått hos Willys: ~1459 tecken/produkt");

  console.log("\n=== EXEMPEL (svenskmärkt) ===");
  console.log(compact(swedish.slice(0, 2).map(pruneProduct)));

  console.log("\nE2E_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
