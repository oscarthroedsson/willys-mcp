import { harvestCookies, readCredentials } from "../src/auth/login.js";
import { findCheapest, type CheapestOptions } from "../src/upstream/cheapest.js";

/** Exercise the ranking layer against production. */

const SCENARIOS: Array<{ label: string; opts: CheapestOptions }> = [
  {
    label: "FRITEXT 'köttfärs' — inget filter (visar fällan)",
    opts: {
      query: "köttfärs",
      onlySwedish: false,
      requireSwedishMeat: false,
      excludeBrands: [],
      onlyBuyable: true,
      limit: 4,
    },
  },
  {
    label: 'KATEGORI "Kött" — svenskt kött, utan Eldorado/Garant',
    opts: {
      query: "köttfärs",
      category: "Kött",
      onlySwedish: false,
      requireSwedishMeat: true,
      excludeBrands: ["Eldorado", "Garant"],
      onlyBuyable: true,
      limit: 5,
    },
  },
  {
    label: "Behov 1,7 kg kyckling — total kostnad, inte jämförpris",
    opts: {
      query: "kycklingfilé",
      onlySwedish: false,
      requireSwedishMeat: true,
      excludeBrands: [],
      onlyBuyable: true,
      need: "1.7 kg",
      limit: 5,
    },
  },
];

async function main() {
  const creds = readCredentials();
  if (!creds.ok) {
    console.log("CREDS_FEL:", creds.message);
    process.exit(1);
  }
  const c = await harvestCookies(creds.data);
  if (!c.ok) {
    console.log("LOGIN_FEL:", c.kind, c.message);
    process.exit(1);
  }
  console.log("inloggad\n");

  for (const s of SCENARIOS) {
    const r = await findCheapest(c.data, s.opts);
    console.log(`=== ${s.label} ===`);
    if (!r.ok) {
      console.log("  FEL:", r.kind, r.message);
      continue;
    }
    const d = r.data;
    console.log(
      `  träffar=${d.totalHits} granskade=${d.inspected}` +
        (d.appliedCategory ? ` kategori="${d.appliedCategory}"` : ""),
    );
    console.log(
      "  tillgängliga kategorier: " +
        d.availableCategories
          .slice(0, 6)
          .map((c) => `${c.name}(${c.count})`)
          .join(", "),
    );
    console.log(`  bortfiltrerade: ${JSON.stringify(d.filteredOut)}`);
    if (d.note) console.log(`  NOTERING: ${d.note}`);
    for (const p of d.products) {
      const pack = p.packaging
        ? ` | ${p.packaging.packages}×${p.unit} = ${p.packaging.totalAmount}g (${p.packaging.surplus}g över) ≈ ${p.estimatedCost} kr`
        : "";
      console.log(
        `  ${String(p.perUnit ?? p.price).padStart(7)} ${p.compareUnit ? `kr/${p.compareUnit}` : "kr  "}  ` +
          `${p.name.slice(0, 40).padEnd(40)} [${(p.brand ?? "-").slice(0, 12)}]` +
          `${p.swedishMeat ? " SV-KÖTT" : ""}${pack}`,
      );
    }
    console.log();
  }

  console.log("DEMO_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
