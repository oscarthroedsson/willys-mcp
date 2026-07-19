import {
  addRecipe,
  clearPlan,
  listNeeds,
  listRecipes,
  removeRecipe,
} from "../src/planner/ledger.js";

/**
 * Ledger aggregation, no network.
 *
 * Uses its own plan id so it never collides with a real shopping plan in the
 * same database. Clears itself on the way in and out.
 */

const PLAN = "__test_plan__";
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

clearPlan(PLAN);

console.log("=== tre recept vill ha ägg ===");
addRecipe(PLAN, "Mån", [{ query: "ägg", amount: "6 st" }]);
addRecipe(PLAN, "Ons", [{ query: "ägg", amount: "4 st" }]);
addRecipe(PLAN, "Tors", [
  { query: "ägg", amount: "3 st" },
  { query: "vispgrädde", amount: "5 dl" },
]);

{
  const { needs, conflicts } = listNeeds(PLAN);
  const agg = needs.find((n) => n.key === "ägg");

  check("två distinkta varor", needs.length, 2);
  check("äggen aggregerades till 13", agg?.amount, 13);
  check("härkomsten bevarad", agg?.sources.length, 3);
  check(
    "härkomst per recept",
    agg?.sources.map((s) => `${s.recipe}:${s.raw}`),
    ["Mån:6 st", "Ons:4 st", "Tors:3 st"],
  );
  check("inga konflikter", conflicts.length, 0);
}

console.log("\n=== samma receptnamn igen ersätter, dubblerar inte ===");
addRecipe(PLAN, "Mån", [{ query: "ägg", amount: "2 st" }]);
{
  const agg = listNeeds(PLAN).needs.find((n) => n.key === "ägg");
  check("6 ersattes av 2 → 9 totalt", agg?.amount, 9);
  check("fortfarande tre källor", agg?.sources.length, 3);
}

console.log("\n=== borttaget recept försvinner ur behovet ===");
removeRecipe(PLAN, "Tors");
{
  const { needs } = listNeeds(PLAN);
  const agg = needs.find((n) => n.key === "ägg");
  check("grädden borta helt", needs.some((n) => n.key === "vispgrädde"), false);
  check("äggen nere på 6", agg?.amount, 6);
  check("recept kvar", listRecipes(PLAN), ["Mån", "Ons"]);
}

console.log("\n=== strängaste kravet vinner ===");
clearPlan(PLAN);
addRecipe(PLAN, "A", [{ query: "kyckling", amount: "500 g" }]);
addRecipe(PLAN, "B", [
  { query: "kyckling", amount: "300 g", requireSwedishMeat: true, mustContain: ["filé"] },
]);
{
  const agg = listNeeds(PLAN).needs.find((n) => n.key === "kyckling");
  check("mängder summerade", agg?.amount, 800);
  check("svenskt kött-kravet smittar hela raden", agg?.requireSwedishMeat, true);
  check("mustContain slås ihop", agg?.mustContain, ["filé"]);
}

console.log("\n=== måttslagskrock blir konflikt, inte felaktig summa ===");
clearPlan(PLAN);
addRecipe(PLAN, "A", [{ query: "tomat", amount: "2 st" }]);
addRecipe(PLAN, "B", [{ query: "tomat", amount: "400 g" }]);
{
  const { needs, conflicts } = listNeeds(PLAN);
  check("ingen behovsrad skapades", needs.length, 0);
  check("en konflikt rapporterad", conflicts.length, 1);
  check("båda måttslagen listade", conflicts[0]?.measures.length, 2);
}

console.log("\n=== otolkbar mängd avvisas med förklaring ===");
clearPlan(PLAN);
{
  const r = addRecipe(PLAN, "A", [
    { query: "salt", amount: "en nypa" },
    { query: "mjöl", amount: "200 g" },
  ]);
  check("en godtagen", r.accepted, 1);
  check("en avvisad", r.rejected.length, 1);
  check("avvisningen namnger varan", r.rejected[0]?.query, "salt");
}

clearPlan(PLAN);
console.log(
  failures === 0 ? "\nALLA TESTER GRÖNA" : `\n${failures} TEST MISSLYCKADES`,
);
process.exit(failures === 0 ? 0 : 1);
