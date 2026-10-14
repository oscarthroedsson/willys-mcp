import { findCheapest, type CheapestOptions } from "../src/chains/cheapest.js";
import { willys } from "../src/chains/axfood.js";

/** Search is unauthenticated, so this needs no session. */

const CASES: Array<{ label: string; opts: CheapestOptions }> = [
  {
    label: "utan kategori (fällan)",
    opts: { query: "köttfärs", onlySwedish: false, requireSwedishMeat: false,
            excludeBrands: [], onlyBuyable: true, limit: 4 },
  },
  {
    label: 'kategori "Kött"',
    opts: { query: "köttfärs", category: "Kött", onlySwedish: false,
            requireSwedishMeat: false, excludeBrands: [], onlyBuyable: true, limit: 4 },
  },
  {
    label: 'kategori "Kött" + svenskt kött + utan Garant, behov 1,7 kg',
    opts: { query: "köttfärs", category: "Kött", onlySwedish: false,
            requireSwedishMeat: true, excludeBrands: ["Garant"],
            onlyBuyable: true, need: "1.7 kg", limit: 4 },
  },
];

async function main() {
  for (const c of CASES) {
    const r = await findCheapest(willys, { cookies: "" }, c.opts);
    console.log(`=== ${c.label} ===`);
    if (!r.ok) { console.log("  FEL:", r.kind, r.message); continue; }
    const d = r.data;
    console.log(`  träffar=${d.totalHits} granskade=${d.inspected}` +
      (d.appliedCategory ? ` kategori="${d.appliedCategory}"` : ""));
    console.log("  kategorier: " + d.availableCategories.slice(0,5)
      .map((x) => `${x.name}(${x.count})`).join(", "));
    console.log(`  bortfiltrerade: ${JSON.stringify(d.filteredOut)}`);
    if (d.note) console.log(`  NOTERING: ${d.note}`);
    for (const p of d.products) {
      const pk = p.packaging
        ? ` | ${p.packaging.packages}×${p.unit} ≈ ${p.estimatedCost} kr`
        : "";
      console.log(`  ${String(p.perUnit ?? p.price).padStart(7)} kr/${p.compareUnit ?? "?"}  ` +
        `${p.name.slice(0,38).padEnd(38)} [${(p.brand ?? "-").slice(0,10)}]${p.swedishMeat ? " SV" : ""}${pk}`);
    }
    console.log();
  }
  console.log("KAT_KLAR");
  process.exit(0);
}
main().catch((e) => { console.log("KRASCH:", e instanceof Error ? e.message : String(e)); process.exit(1); });
