import { parseVolume, parseRequirement, packagesNeeded, unitPrice } from "../src/domain/volume.js";

const REAL = ["1,5l","100g","10p","125g","12p","140g","150g","15p","15st","160g","18p","1kg","1l",
"2,5dl","200g","20p","24p","250g","2kg","300g","350g","3dl","400g","450g","500g","540g","550g","5dl",
"600g","670g","6p","750g","800g","80g","900g","ca: 1.1kg","ca: 1.2kg","ca: 175g","ca: 1kg","ca: 2.2kg",
"ca: 667g","ca: 700g","ca: 750g","ca: 850g","ca: 925g"];

let fail = 0;
for (const r of REAL) { if (!parseVolume(r)) { console.log("PARSE-FEL:", r); fail++; } }
console.log(`parsade ${REAL.length - fail}/${REAL.length} verkliga format`);

console.log("\n=== stickprov ===");
for (const r of ["ca: 850g","1,5l","2,5dl","15st","2kg"]) {
  const p = parseVolume(r)!;
  console.log(`${r.padEnd(10)} -> ${p.amount} (${p.measure}${p.approximate ? ", ungefärlig" : ""})`);
}

console.log("\n=== 500 g köttfärs mot olika förpackningar ===");
const need = parseRequirement("500 g köttfärs")!;
for (const r of ["500g","ca: 850g","1kg","250g"]) {
  const m = packagesNeeded(need, parseVolume(r)!)!;
  console.log(`  ${r.padEnd(9)} -> ${m.packages} paket, ${m.totalAmount}g, ${m.surplus}g över${m.approximate ? " (ungefärlig)" : ""}`);
}

console.log("\n=== enhetsprisfall ===");
console.log("  85,08 kr / 1kg   ->", JSON.stringify(unitPrice(85.08, parseVolume("1kg"))));
console.log("  19,90 kr / 2,5dl ->", JSON.stringify(unitPrice(19.90, parseVolume("2,5dl"))));

console.log("\n=== mätslagskrock ska ge null ===");
console.log("  behöver 5dl, paket 850g ->", packagesNeeded(parseRequirement("5 dl")!, parseVolume("ca: 850g")!));
console.log("\n=== skräpindata ===");
for (const junk of ["", "abc", "12", "kg", null]) console.log(`  ${JSON.stringify(junk)} ->`, parseVolume(junk as any));

console.log("\n=== avrunnen vikt 650/350g -> 350g (drained) ===");
{
  const v = parseVolume("650/350g");
  const ok = v?.amount === 350 && v?.measure === "mass";
  console.log(`  650/350g -> ${JSON.stringify(v?.amount)} ${v?.measure} ${ok ? "ok" : "FEL"}`);
  if (!ok) fail = 1;
  const c = parseVolume("ca: 650/350g");
  console.log(`  ca: 650/350g -> ${JSON.stringify(c?.amount)} approx=${c?.approximate}`);
  if (c?.amount !== 350) fail = 1;
}
process.exit(fail ? 1 : 0);
