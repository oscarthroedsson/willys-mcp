import { displayVolume, toCgProduct } from "../src/upstream/citygross/map.js";
import { splitNameExtra, toMathemProduct } from "../src/upstream/mathem/map.js";
import { byUnitPrice, rankByUnit, rankCandidates } from "../src/chains/cheapest.js";
import { isUnwantedPetFood, looselyRelates, sameHead } from "../src/domain/name-match.js";
import { vetUnitPrice } from "../src/domain/unit-price.js";
import { allAdapters } from "../src/chains/registry.js";
import { CHAIN_IDS } from "../src/chains/types.js";
import { parseVolume } from "../src/domain/volume.js";
import type { Product } from "../src/domain/product.js";

/** City Gross and Mathem mapping, shared ranking, and the registry. Offline. */

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

// ── registry ──
check("varje ChainId har en adapter", allAdapters().length === CHAIN_IDS.length);
check("ICA finns inte", !(CHAIN_IDS as readonly string[]).includes("ica"));

// ── City Gross ──
check("CA200G → 'ca: 200g'", displayVolume("CA200G") === "ca: 200g");
check("1,5L → '1,5l' och parsas", displayVolume("1,5L") === "1,5l" && parseVolume("1,5l")?.amount === 1500);
check("5DL parsas som 500 ml", parseVolume(displayVolume("5DL"))?.amount === 500);

const blandfars = toCgProduct({
  id: "101408266_KG", name: "Blandfärs 50/50", descriptiveSize: "CA900G", superCategory: "Kött & fågel",
  markings: [{ code: "KOTT_FRAN_SVERIGE" }],
  productStoreDetails: { prices: {
    currentPrice: { price: 123, unit: "KGM", comparativePrice: 123, comparativePriceUnit: "KGM" },
    activePromotion: { membersOnly: false, minQuantity: 1, priceDetails: { price: 99.95, comparativePrice: 99.95, comparativePriceUnit: "KGM" } },
  } },
})!;
check("CG: kampanjpris är priset, inte currentPrice", blandfars.price === 99.95 && blandfars.perUnit === 99.95);
// 99,95 kr/kg × 0,9 kg = 89,955; float rounding may land on either öre.
check("CG: viktvara ger styckpris via förpackning", Math.abs((blandfars.packagePrice ?? 0) - 89.955) <= 0.01, String(blandfars.packagePrice));
check("CG: besparing", blandfars.saving === 23.05, String(blandfars.saving));
check("CG: svenskt kött", blandfars.swedishMeat && blandfars.origin === "SE");
check("CG: kategori", blandfars.category === "Kött & fågel");

const member = toCgProduct({
  id: "1_ST", name: "Ost", descriptiveSize: "500G",
  productStoreDetails: { prices: {
    currentPrice: { price: 60, unit: "PCE", comparativePrice: 120, comparativePriceUnit: "KGM" },
    activePromotion: { membersOnly: true, minQuantity: 1, priceDetails: { price: 45, comparativePrice: 90 } },
  } },
})!;
check("CG: medlemspris sänker inte priset", member.price === 60 && member.perUnit === 120);

// ── Mathem ──
check("'Polen, 340 g' → storlek och land", JSON.stringify(splitNameExtra("Polen, 340 g")) === '{"size":"340 g","country":"Polen"}');
check("'1,5 l' delas inte på decimalkommat", splitNameExtra("1,5 l").size === "1,5 l");
check("'Sverige, 500 g' → svenskt", toMathemProduct({ id: 1, full_name: "Morötter", name_extra: "Sverige, 500 g", gross_price: "12.95" })!.origin === "SE");
const sale = toMathemProduct({
  id: 2, full_name: "Kaffe", name_extra: "450 g", gross_price: "49.90", gross_unit_price: "110.89",
  unit_price_quantity_abbreviation: "kg", discount: { is_discounted: true, undiscounted_gross_price: "69.90" },
  availability: { is_available: false }, client_classifiers: [{ name: "Svensk Fågel" }, { name: "Keyhole" }],
})!;
check("Mathem: pris som tal", sale.price === 49.9 && sale.perUnit === 110.89);
check("Mathem: besparing mot ordinarie", sale.saving === 20);
check("Mathem: slut i lager → ej köpbar", sale.buyable === false);
check("Mathem: klassificerare → flaggor", sale.flags.includes("svensk_fagel") && sale.flags.includes("nyckelhalet") && sale.swedishMeat);

// ── ranking never trusts upstream order ──
const p = (name: string, perUnit: number | null): Product => ({
  code: name, name, brand: null, price: perUnit ?? 1, packagePrice: perUnit, unit: null, compare: null,
  compareUnit: "kg", perUnit, origin: "OKAND" as Product["origin"], swedishMeat: false, flags: [],
  onSale: false, saving: null, buyable: true,
});
const ranked = rankCandidates([p("mjölk dyr", 15), p("mjölk okänd", null), p("mjölk billig", 10)], {
  query: "mjölk", onlySwedish: false, requireSwedishMeat: false, excludeBrands: [], onlyBuyable: true, limit: 10,
});
check("servern sorterar på jämförpris", ranked.products.map((x) => x.name).join(",") === "mjölk billig,mjölk dyr,mjölk okänd");
check("byUnitPrice lägger null sist", [p("a", null), p("b", 1)].sort(byUnitPrice)[0]!.name === "b");

// ── #44: relevance ──
check("köttfärs ~ Nötfärs (samma efterled)", looselyRelates("Nötfärs 12%", "köttfärs"));
check("köttfärs ~ Blandfärs", looselyRelates("Blandfärs 50/50", "köttfärs"));
check("sameHead kräver minst 4 tecken", !sameHead("kaffe", "tofe"));
check("tamponger relaterar fortfarande inte", !looselyRelates("Mini Tamponger", "mineralvatten naturell"));
check("kattmat i djurkategori sorteras bort", isUnwantedPetFood({ name: "Nötfärs i gelé", category: "Djurmat & Tillbehör" }, "köttfärs"));
check("hundtugg på namn sorteras bort", isUnwantedPetFood({ name: "Torkad Grisöra Hundtugg" }, "torkad dragon"));
check("Kattmat Nötfärs på namn", isUnwantedPetFood({ name: "Kattmat Kastrerad Nötfärs" }, "köttfärs"));
check("frågan gäller djur → behålls", !isUnwantedPetFood({ name: "Kattmat Lax", category: "Djurmat" }, "kattmat"));
check("vanlig färs behålls", !isUnwantedPetFood({ name: "Nötfärs 12%", category: "Kött, Fågel & Chark" }, "köttfärs"));

// ── #43: sanity ──
const coopBug = vetUnitPrice({ ...p("Nötfärs 12%", 0.2), packagePrice: 199, unit: "1000g" });
check("Coop-felet 0,20 kr/kg ersätts av 199", coopBug.perUnit === 199 && coopBug.perUnitSource === "beraknat", String(coopBug.perUnit));
const fine = vetUnitPrice({ ...p("Mjölk", 11.3), packagePrice: 16.95, unit: "1,5l", compareUnit: "l" });
check("rimligt uppströmsvärde behålls", fine.perUnit === 11.3 && fine.perUnitSource === "uppstroms");
const unknown = vetUnitPrice({ ...p("Ägg", 3.5), unit: null });
check("utan förpackning: okontrollerat", unknown.perUnitSource === "okontrollerat" && unknown.perUnit === 3.5);

// ── #42: mixed units ──
const mixed = rankByUnit([
  { ...p("ägg", 3), compareUnit: "st" },
  { ...p("färs dyr", 120), compareUnit: "kg" },
  { ...p("färs billig", 80), compareUnit: "kg" },
]);
check("vanligaste enheten först", mixed.ordered.map((x) => x.name).join(",") === "färs billig,färs dyr,ägg");
check("blandade enheter ger notering", Boolean(mixed.mixedNote));

console.log(failures === 0 ? "ALLA TESTER GRÖNA" : `${failures} FEL`);
process.exit(failures === 0 ? 0 : 1);
