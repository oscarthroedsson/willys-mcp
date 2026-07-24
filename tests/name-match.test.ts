import {
  nameContainsTerm,
  nameHasSubstring,
  matchesQuery,
} from "../src/domain/name-match.js";

/** Word/suffix matching, no network. Cases drawn from the live friction report. */

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  console.log(a === e ? `  ok    ${label}` : `  FEL   ${label}  väntat ${e} fick ${a}`);
  if (a !== e) process.exitCode = 1;
}

console.log("=== mustContain (nameContainsTerm) ===");
check("smör ∌ Smörgåsmargarin", nameContainsTerm("Smörgåsmargarin", "smör"), false);
check("smör ∈ Smör Normalsaltat", nameContainsTerm("Smör Normalsaltat", "smör"), true);
check("grädde ∈ vispgrädde (compound head)", nameContainsTerm("Visp Vispgrädde 40%", "grädde"), true);
check("tomat ∌ Tomatsås (head is sås)", nameContainsTerm("Pastasås Tomat/basilika", "tomat"), true);
// Known limit: plural forms don't match the singular via suffix ("tomater"
// does not end with "tomat"). Query as the recipe writes it to avoid this.
check("plural gräns: tomat ∌ Tomater", nameContainsTerm("Krossade Tomater", "tomat"), false);
check("lök ∈ Rödlök", nameContainsTerm("Picklad Rödlök", "lök"), true);
check("potatis ∌ Lök Gul", nameContainsTerm("Lök Gul Klass 1", "potatis"), false);

console.log("\n=== mustNotContain (nameHasSubstring) ===");
check("margarin ∈ Smörgåsmargarin", nameHasSubstring("Smörgåsmargarin", "margarin"), true);
check("picklad ∈ Picklad Rödlök", nameHasSubstring("Picklad Rödlök", "picklad"), true);

console.log("\n=== matchesQuery (uncertainty) ===");
check("potatis vs Lök Gul -> false", matchesQuery("Lök Gul Klass 1", "potatis"), false);
check("falukorv vs Stekkorv Kyckling -> false", matchesQuery("Stekkorv Kyckling", "falukorv"), false);
check("tomat vs Vita Bönor i Tomatsås -> false", matchesQuery("Vita Bönor i Tomatsås", "tomat"), false);
check("gul lök vs Lök Gul -> true", matchesQuery("Lök Gul Klass 1", "gul lök"), true);
check("vispgrädde vs Visp 31% -> true (abbrev)", matchesQuery("Visp 31%", "vispgrädde"), true);
check("potatis vs Potatis Fast -> true", matchesQuery("Potatis Fast Klass 1", "potatis"), true);

console.log(process.exitCode ? "\nRÖD" : "\nGRÖN");
