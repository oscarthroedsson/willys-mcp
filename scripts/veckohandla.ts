import { harvestCookies, readCredentials } from "../src/auth/login.js";
import { createSession, findValidSession, getCookies } from "../src/auth/session.js";
import { verifySession } from "../src/auth/login.js";
import { addToCart, getCart } from "../src/upstream/cart.js";
import { findCheapest } from "../src/upstream/cheapest.js";

/**
 * Week shop: four recipes, aggregated, matched and added to the cart.
 * Never checks out — there is no checkout tool.
 */

interface Item {
  /** What the recipes need, aggregated. */
  label: string;
  query: string;
  category?: string;
  need?: string;
  swedishMeat?: boolean;
  qty?: number;
  /** Recipes this line serves. */
  from: string;
}

const LIST: Item[] = [
  // Fisk & skaldjur
  { label: "Torskfilé 400 g", query: "torskfilé", category: "Fisk", need: "400 g", from: "Mån" },
  { label: "Skalade räkor 150 g", query: "skalade räkor", need: "150 g", from: "Mån" },
  // Kött — svenskt krav
  { label: "Falukorv 600 g", query: "falukorv", category: "Chark", need: "600 g", swedishMeat: true, from: "Ons" },
  { label: "Kycklinglårfilé 500 g", query: "kycklinglårfilé", need: "500 g", swedishMeat: true, from: "Tors" },
  // Mejeri
  { label: "Vispgrädde 8 dl", query: "vispgrädde", category: "Mejeri", need: "8 dl", from: "Mån+Ons+Tors" },
  { label: "Smör 60 g", query: "smör", category: "Mejeri", from: "Mån+Tors" },
  { label: "Ägg 4 st", query: "ägg", category: "Ägg", from: "Tis" },
  // Grönt
  { label: "Morot", query: "morot", category: "Frukt & Grönt", from: "Mån" },
  { label: "Gul lök 4 st", query: "gul lök", category: "Frukt & Grönt", from: "Mån+Ons+Tors" },
  { label: "Purjolök 2 st", query: "purjolök", category: "Frukt & Grönt", qty: 2, from: "Tis+Tors" },
  { label: "Champinjoner 400 g", query: "champinjoner", need: "400 g", from: "Tis" },
  { label: "Vitlök", query: "vitlök", category: "Frukt & Grönt", from: "Tis+Ons" },
  { label: "Vitkål", query: "vitkål", category: "Frukt & Grönt", from: "Tis" },
  { label: "Färsk spenat 300 g", query: "färsk spenat", need: "300 g", from: "Tis+Tors" },
  { label: "Fänkål", query: "fänkål", category: "Frukt & Grönt", from: "Tors" },
  { label: "Dill", query: "dill kruka", from: "Mån" },
  { label: "Dragon färsk", query: "dragon kruka", from: "Tors" },
  { label: "Citron 2 st", query: "citron", category: "Frukt & Grönt", qty: 2, from: "Mån+Tors" },
  // Skafferi
  { label: "Jasminris 1 kg", query: "jasminris", need: "1 kg", from: "Tis+Ons+Tors" },
  { label: "Japansk soja", query: "japansk soja", from: "Tis+Ons" },
  { label: "Sesamolja", query: "sesamolja", from: "Tis" },
  { label: "Gochujang", query: "gochujang", from: "Tis" },
  { label: "Sesamfrön", query: "sesamfrön", from: "Tis" },
  { label: "Rapsolja", query: "rapsolja", from: "Tis+Ons" },
  { label: "Olivolja", query: "olivolja", from: "Tors" },
  { label: "Krossade tomater 400 g", query: "krossade tomater", from: "Ons" },
  { label: "Ketchup", query: "ketchup", from: "Ons" },
  { label: "Dijonsenap", query: "dijonsenap", from: "Ons+Tors" },
  { label: "Oregano torkad", query: "oregano", from: "Ons" },
  { label: "Dragon torkad", query: "torkad dragon", from: "Tors" },
  { label: "Syltlök", query: "syltlök", from: "Tors" },
  { label: "Saltgurka", query: "saltgurka", from: "Ons" },
  { label: "Fiskbuljong", query: "fiskbuljong", from: "Mån" },
  { label: "Kycklingbuljong", query: "kycklingbuljong", from: "Tors" },
];

async function session(): Promise<string> {
  const existing = findValidSession();
  if (existing && (await verifySession(existing.cookies)).ok) {
    console.log(`session återanvänd: ${existing.id}`);
    return existing.cookies;
  }
  const creds = readCredentials();
  if (!creds.ok) throw new Error(creds.message);
  const h = await harvestCookies(creds.data);
  if (!h.ok) throw new Error(`${h.kind}: ${h.message}`);
  const id = createSession(h.data);
  console.log(`ny session: ${id}`);
  return getCookies(id)!;
}

/** --dry matches and prices everything without touching the cart (search is unauthenticated). */
const DRY = process.argv.includes("--dry");

async function main() {
  const cookies = DRY ? "" : await session();

  if (!DRY) {
    const before = await getCart(cookies);
    console.log(`kundvagn före: ${before.ok ? before.data.items : "?"} varor\n`);
  } else {
    console.log("TORRKÖRNING — inget läggs i kundvagnen\n");
  }

  const added: string[] = [];
  const failed: string[] = [];
  let total = 0;

  for (const it of LIST) {
    const r = await findCheapest(cookies, {
      query: it.query,
      category: it.category,
      onlySwedish: false,
      requireSwedishMeat: it.swedishMeat ?? false,
      excludeBrands: [],
      onlyBuyable: true,
      need: it.need,
      limit: 1,
    });

    if (!r.ok || r.data.products.length === 0) {
      const why = r.ok ? "ingen träff efter filter" : `${r.kind}`;
      console.log(`MISS  ${it.label.padEnd(26)} ${why}`);
      failed.push(`${it.label} (${why})`);
      continue;
    }

    const p = r.data.products[0]!;
    const qty = it.qty ?? p.packaging?.packages ?? 1;
    const add = DRY
      ? ({ ok: true } as const)
      : await addToCart(cookies, p.code, qty);

    if (!add.ok) {
      console.log(`MISS  ${it.label.padEnd(26)} kunde ej läggas i: ${add.kind}`);
      failed.push(`${it.label} (${add.kind})`);
      continue;
    }

    const cost = p.price !== null ? (p.price * qty).toFixed(2) : "?";
    if (p.price !== null) total += p.price * qty;
    console.log(
      `OK    ${it.label.padEnd(26)} ${qty}× ${p.name.slice(0, 34).padEnd(34)} ` +
        `${String(p.price).padStart(7)} kr  = ${cost} kr${p.swedishMeat ? "  SV-KÖTT" : ""}`,
    );
    added.push(`${it.label} -> ${qty}× ${p.name} (${cost} kr)`);
  }

  if (!DRY) {
    const after = await getCart(cookies);
    console.log(`\nkundvagn efter: ${after.ok ? after.data.items : "?"} varor, ${after.ok ? after.data.total : "?"}`);
  }
  console.log(`rader: ${added.length} | missar: ${failed.length} | summa ca ${total.toFixed(2)} kr`);
  for (const f of failed) console.log(`  MISS: ${f}`);
  console.log("\nHANDLA_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
