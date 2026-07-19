import { findCheapest } from "../src/upstream/cheapest.js";

/**
 * Print candidates for review. Chooses nothing.
 *
 * Search is unauthenticated, so this needs no session. The point is to put
 * real options in front of a human (or the model) rather than blindly taking
 * the cheapest hit — which is how a dried pig ear once qualified as tarragon.
 */

const QUERIES = process.argv.slice(2);

async function main() {
  for (const q of QUERIES) {
    const [query, category] = q.split("|");
    const r = await findCheapest("", {
      query: query!,
      category: category || undefined,
      onlySwedish: false,
      requireSwedishMeat: false,
      excludeBrands: [],
      onlyBuyable: true,
      limit: 8,
    });

    console.log(`\n### ${query}${category ? ` [${category}]` : ""}`);
    if (!r.ok) {
      console.log(`  FEL ${r.kind}: ${r.message}`);
      continue;
    }
    console.log(
      `  ${r.data.totalHits} träffar | kategorier: ` +
        r.data.availableCategories
          .slice(0, 5)
          .map((c) => `${c.name}(${c.count})`)
          .join(", "),
    );
    for (const p of r.data.products) {
      console.log(
        `  ${p.code.padEnd(15)} ${String(p.price).padStart(7)} kr  ` +
          `${String(p.perUnit ?? "").padStart(7)} kr/${(p.compareUnit ?? "?").padEnd(2)} ` +
          `${p.name.slice(0, 42).padEnd(42)} ${(p.unit ?? "").padEnd(9)} [${(p.brand ?? "-").slice(0, 14)}]`,
      );
    }
  }
  console.log("\nKANDIDATER_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
