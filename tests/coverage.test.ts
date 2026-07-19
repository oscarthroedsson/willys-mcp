import { planCoverage, type Candidate } from "../src/domain/coverage.js";
import { parseRequirement, parseVolume } from "../src/domain/volume.js";

/**
 * Coverage maths, no network.
 *
 * The egg case is the one that motivated this module: cheapest per unit and
 * cheapest in real money disagree once you can only buy whole packages.
 */

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FEL   ${label}\n          väntat ${e}\n          fick   ${a}`);
    failures++;
  }
}

function candidate(
  code: string,
  name: string,
  price: number,
  size: string,
): Candidate {
  return { code, name, price, pack: parseVolume(size) };
}

console.log("=== 13 ägg: tre förpackningsstorlekar ===");
{
  const need = parseRequirement("13 st")!;
  const r = planCoverage(need, [
    candidate("1_ST", "Ägg 6-pack", 24.9, "6p"),
    candidate("2_ST", "Ägg 10-pack", 34.9, "10p"),
    candidate("3_ST", "Ägg 24-pack", 62.0, "24p"),
  ]);

  console.log(`  billigast: ${r.best?.name} — ${r.best?.totalCost} kr`);
  for (const a of r.alternatives) {
    console.log(`    alt: ${a.name} ${a.packages}× = ${a.totalCost} kr, ${a.surplus} st över`);
  }

  check("billigast är 24-packet", r.best?.code, "3_ST");
  check("ett paket räcker", r.best?.packages, 1);
  check("kostar 62 kr", r.best?.totalCost, 62);
  check("11 ägg över", r.best?.surplus, 11);

  // Cheapest overshoots by 85%, so this must not be decided silently.
  check("beslutsläge uppstår", r.decision !== null, true);
  check("tightaste alternativet är 10-packet", r.decision?.tightest.code, "2_ST");
  check("merkostnad för tightare val", r.decision?.extraCost, 7.8);
  console.log(`  fråga: ${r.decision?.question}`);
}

console.log("\n=== 500 g köttfärs: inget överskott värt att fråga om ===");
{
  const need = parseRequirement("500 g")!;
  const r = planCoverage(need, [
    candidate("A_ST", "Köttfärs 500 g", 49.9, "500g"),
    candidate("B_ST", "Köttfärs 1 kg", 89.0, "1kg"),
  ]);

  check("billigast är 500 g-paketet", r.best?.code, "A_ST");
  check("noll överskott", r.best?.surplus, 0);
  check("ingen fråga behövs", r.decision, null);
}

console.log("\n=== måttslagskrock och opriskbara varor avvisas ===");
{
  const need = parseRequirement("5 dl")!;
  const r = planCoverage(need, [
    candidate("C_ST", "Grädde 5 dl", 22.9, "5dl"),
    candidate("D_ST", "Ost 850 g", 79.0, "ca: 850g"),
    { code: "E_ST", name: "Utan pris", price: null, pack: parseVolume("1l") },
    { code: "F_ST", name: "Oläsbar förpackning", price: 10, pack: null },
  ]);

  check("bara grädden dög", r.best?.code, "C_ST");
  check("tre kandidater avvisades", r.rejected.length, 3);
  check(
    "avvisningsskäl",
    r.rejected.map((x) => x.reason).sort(),
    ["measure_mismatch", "no_price", "unparseable_pack"],
  );
}

console.log("\n=== billigare OCH tightare ger ingen fråga ===");
{
  // If the tighter option is also cheaper it is already `best`; there is no
  // trade-off left to present.
  const need = parseRequirement("10 st")!;
  const r = planCoverage(need, [
    candidate("G_ST", "Bulk 30-pack", 99.0, "30p"),
    candidate("H_ST", "Exakt 10-pack", 30.0, "10p"),
  ]);

  check("billigast är 10-packet", r.best?.code, "H_ST");
  check("ingen fråga", r.decision, null);
}

console.log(
  failures === 0
    ? "\nALLA TESTER GRÖNA"
    : `\n${failures} TEST MISSLYCKADES`,
);
process.exit(failures === 0 ? 0 : 1);
