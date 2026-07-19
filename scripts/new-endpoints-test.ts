import { getCampaigns, getProductDetail } from "../src/upstream/client.js";

async function main() {
  console.log("=== KAMPANJER butik 2220 ===");
  const c = await getCampaigns("", "2220", 0, 5);
  if (!c.ok) console.log("  FEL:", c.kind, c.message);
  else {
    console.log(`  ${c.data.totalHits} kampanjprodukter`);
    for (const p of c.data.products) {
      console.log(`  ${String(p.price).padStart(7)} kr  ${p.name.slice(0,40).padEnd(40)}` +
        `${p.onSale ? " REA" : ""}${p.origin === "SE" ? " SE" : ""}${p.saving ? ` -${p.saving}` : ""}`);
    }
  }

  console.log("\n=== PRODUKT-REST (ersätter buildId-routen) ===");
  const d = await getProductDetail("", "101233933_ST");
  if (!d.ok) console.log("  FEL:", d.kind, d.message);
  else {
    const p = d.data;
    console.log(`  ${p.name} [${p.brand}] ${p.unit}`);
    console.log(`  pris: ${p.price} | jämför: ${p.compare} | ursprung: ${p.origin} | flaggor: ${p.flags.join(",")}`);
    console.log(`  ingredienser: ${p.ingredients ? p.ingredients.slice(0,90) + "…" : "(saknas)"}`);
    console.log(`  näringsvärden: ${p.nutrition ? "finns" : "saknas"}`);
  }

  console.log("\n=== 404 ska ge NOT_FOUND, inte krasch ===");
  const bad = await getProductDetail("", "000000000_ST");
  console.log("  ", bad.ok ? "oväntat OK" : `${bad.kind}: ${bad.message.slice(0,70)}`);

  console.log("\nNYA_KLAR");
  process.exit(0);
}
main().catch((e) => { console.log("KRASCH:", e instanceof Error ? e.message : String(e)); process.exit(1); });
