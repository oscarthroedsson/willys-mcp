import { compareVersions, parseChangelog } from "../src/releases.js";
import { RETIRED_TOOLS, TOOL } from "../src/constants/index.js";

/** Release notes and tombstones, offline. */

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

const src = [
  "# Changelog", "", "## [Unreleased]", "", "### Brytande", "- a", "",
  "## [2.0.0] - 2026-11-01", "### Brytande", "- b", "",
  "## [1.1.0] - 2026-10-20", "### Tillagt", "- c", "",
  "## [1.0.0] - 2026-07-31", "- d",
].join("\n");

const released = parseChangelog(src);
check("utan unreleased: bara släppta", released.map((r) => r.version).join(",") === "2.0.0,1.1.0,1.0.0");
check("brytande känns igen", released[0]!.breaking && !released[1]!.breaking);
const all = parseChangelog(src, true);
check("med unreleased: först och märkt", all[0]!.version === "unreleased" && !all[0]!.released && all[0]!.breaking);
const empty = parseChangelog("## [Unreleased]\n\n## [1.0.0] - 2026-07-31\n- d", true);
check("tom unreleased tas inte med", empty.length === 1 && empty[0]!.version === "1.0.0");
check("semver jämförs numeriskt", compareVersions("1.10.0", "1.9.0") > 0 && compareVersions("2.0.0", "2.0.0") === 0);

// Every 1.x tool name must redirect, and every redirect must point at a real tool.
const live = new Set<string>(Object.values(TOOL));
const dangling = Object.entries(RETIRED_TOOLS).filter(([, r]) => r.replacement && !live.has(r.replacement));
check("varje tombstone pekar på ett verktyg som finns", dangling.length === 0, dangling.map(([n]) => n).join(","));
const v1 = ["willys_search", "willys_find_cheapest", "willys_plan_apply", "willys_login", "willys_nearest_stores", "willys_refresh_stores", "willys_get_product_detail"];
check("1.x-namn har tombstones", v1.every((n) => n in RETIRED_TOOLS));
check("inget levande verktyg är också tombstone", Object.keys(RETIRED_TOOLS).every((n) => !live.has(n)));

console.log(failures === 0 ? "ALLA TESTER GRÖNA" : `${failures} FEL`);
process.exit(failures === 0 ? 0 : 1);
