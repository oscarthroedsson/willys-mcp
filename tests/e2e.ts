import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVolume } from "../src/domain/volume.js";

/**
 * End-to-end over real stdio against the BUILT server (dist/index.js) — the
 * file the MCP client actually runs. Every tool against every chain, with
 * plausibility checks on the prices that come back, the planner across chains,
 * and plan_apply as a dry run (the cart is never touched here; smoke.ts owns
 * the one add/remove round trip).
 *
 *   npm run build && npm run e2e        # needs .env for the login part
 *   E2E_SRC=1 npm run e2e               # run src/ through tsx instead
 *
 * Plans use the id "e2e-test" and are cleared at the end.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = "e2e-test";

const child = process.env.E2E_SRC
  ? spawn("npx", ["tsx", path.join(ROOT, "src/index.ts")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] })
  : spawn("node", [path.join(ROOT, "dist/index.js")], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
const pending = new Map<number, (v: unknown) => void>();
child.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  let i: number;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line) as { id?: number };
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      }
    } catch {
      /* non-JSON on stdout would itself be a protocol bug */
    }
  }
});

let nextId = 1;
function rpc(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 180_000);
    pending.set(id, (v) => {
      clearTimeout(timer);
      resolve(v);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function call(tool: string, args: Record<string, unknown>) {
  const r = await rpc("tools/call", { name: tool, arguments: args });
  const text: string = r?.result?.content?.[0]?.text ?? JSON.stringify(r);
  const isError = r?.result?.isError === true;
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* refusals are plain text */
  }
  return { text, isError, json };
}

const results: Array<{ name: string; ok: boolean }> = [];
function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail.slice(0, 140)}` : ""}`);
}

/** Store per chain for the matrix; null means "no store needed". */
const STORE: Record<string, string | null> = {
  willys: null,
  hemkop: "4146",
  coop: "252500",
  citygross: "3204",
  mathem: null,
};
const CHAINS = Object.keys(STORE);

/**
 * A price is coherent when what one package costs matches the comparison
 * price times the package size. Weighed goods are estimates, so 30 % slack.
 */
function coherent(p: any): { ok: boolean; why: string } {
  const pack = parseVolume(p.unit);
  const price = p.packagePrice ?? p.price;
  if (!pack || p.perUnit == null || price == null) return { ok: true, why: "okontrollerbar" };
  const per =
    p.compareUnit === "kg" && pack.measure === "mass" ? price / (pack.amount / 1000)
    : p.compareUnit === "l" && pack.measure === "volume" ? price / (pack.amount / 1000)
    : p.compareUnit === "st" && pack.measure === "count" ? price / pack.amount
    : null;
  if (per === null) return { ok: true, why: "olika måttslag" };
  const ratio = per / p.perUnit;
  return { ok: ratio > 0.7 && ratio < 1.3, why: `${price} kr / ${p.unit} = ${per.toFixed(2)} vs ${p.perUnit} kr/${p.compareUnit}` };
}

async function chainMatrix(chain: string) {
  const store = STORE[chain];
  const s = store ? { storeId: store } : {};
  const tag = (t: string) => `${chain}: ${t}`;

  // search
  const search = await call("search", { chain, query: "mellanmjölk", size: 5, ...s });
  const prods = search.json?.produkter ?? [];
  record(tag("search"), !search.isError && prods.length > 0 && search.json?.kedja === chain, `${search.json?.traff} träffar`);
  record(tag("search: alla har pris"), prods.length > 0 && prods.every((p: any) => typeof p.price === "number" && p.price > 0));

  // suggestions (Mathem has none and must say so)
  const sugg = await call("search_suggestions", { chain, term: "mjöl", ...s });
  if (chain === "mathem") record(tag("search_suggestions avvisas"), sugg.isError && /stöder det/.test(sugg.text));
  else record(tag("search_suggestions"), !sugg.isError && (sugg.json?.forslag?.length ?? 0) > 0, JSON.stringify(sugg.json?.forslag?.slice(0, 3)));

  // get_product with a code from search
  const code = prods[0]?.code;
  const prod = code ? await call("get_product", { chain, productCode: code, ...s }) : null;
  record(tag("get_product"), Boolean(prod && !prod.isError && prod.json?.code === code), prod?.json?.name ?? "ingen kod");

  // find_cheapest: price must be plausible for milk and coherent with its pack
  const cheap = await call("find_cheapest", { chain, query: "mellanmjölk", mustContain: ["mellanmjölk"], limit: 5, ...s });
  const first = cheap.json?.produkter?.[0];
  record(
    tag("find_cheapest mellanmjölk rimligt pris"),
    Boolean(first) && first.compareUnit === "l" && first.perUnit >= 7 && first.perUnit <= 30,
    first ? `${first.name} ${first.perUnit} kr/${first.compareUnit}` : cheap.text,
  );
  const sorted = (cheap.json?.produkter ?? []).filter((p: any) => p.compareUnit === "l").map((p: any) => p.perUnit);
  record(tag("find_cheapest sorterat stigande"), sorted.every((v: number, i: number) => i === 0 || v >= sorted[i - 1]), sorted.join(" ≤ "));
  for (const p of (cheap.json?.produkter ?? []).slice(0, 3)) {
    const c = coherent(p);
    record(tag(`pris hänger ihop: ${p.name.slice(0, 30)}`), c.ok, c.why);
  }

  // find_cheapest with need: packaging maths on real products
  const need = await call("find_cheapest", { chain, query: "köttfärs", need: "1 kg", limit: 5, ...s });
  const withCost = (need.json?.produkter ?? []).filter((p: any) => p.estimatedCost != null);
  record(
    tag("find_cheapest köttfärs med behov"),
    withCost.length > 0 && withCost.every((p: any) => p.packaging?.packages >= 1),
    withCost[0] ? `${withCost[0].packaging.packages}× ${withCost[0].name} ≈ ${withCost[0].estimatedCost} kr` : need.text,
  );
  const meat = need.json?.produkter?.[0];
  record(
    tag("köttfärs: färs överst, inte sås/paj/djurmat"),
    Boolean(meat) && /färs\b/i.test(meat.name) && !/sås|soppa|paj|katt|hund/i.test(meat.name),
    meat?.name ?? need.text,
  );

  // campaigns (Mathem has none)
  const camp = await call("get_campaigns", { chain, size: 3, storeId: store ?? (chain === "willys" ? "2220" : undefined) });
  if (chain === "mathem") record(tag("get_campaigns avvisas"), camp.isError);
  else record(tag("get_campaigns"), !camp.isError && camp.json?.antal > 0, `${camp.json?.antal} erbjudanden`);

  // stores (Mathem has none)
  if (chain === "mathem") {
    const fs = await call("find_stores", { chain, query: "stockholm" });
    record(tag("find_stores avvisas"), fs.isError);
    return;
  }
  const fs = await call("find_stores", { chain, query: chain === "citygross" ? "malmö" : "göteborg", limit: 3 });
  const storeId = fs.json?.butiker?.[0]?.storeId;
  record(tag("find_stores ort"), !fs.isError && Boolean(storeId), fs.json?.butiker?.map((b: any) => b.name).join(", "));
  const near = await call("find_stores", { chain, lat: 57.7, lng: 11.97, limit: 2 });
  if (chain === "citygross") record(tag("find_stores koordinat: säger att det saknas"), near.isError && /koordinat/.test(near.text));
  else record(tag("find_stores koordinat"), !near.isError && near.json?.butiker?.[0]?.distanceKm >= 0, near.json?.butiker?.map((b: any) => `${b.name} ${b.distanceKm} km`).join(", "));
  const gs = storeId ? await call("get_store", { chain, storeId }) : null;
  record(tag("get_store"), Boolean(gs && !gs.isError && gs.json?.storeId === storeId), gs?.json?.name ?? "");
}

async function main() {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  record("initialize", Boolean(init?.result?.serverInfo), JSON.stringify(init?.result?.serverInfo));

  for (const chain of CHAINS) await chainMatrix(chain);

  // Coop postcode → the e-commerce store that delivers there
  const pc = await call("find_stores", { chain: "coop", query: "413 01" });
  record("coop: postnummer ger levererande butik", pc.json?.levererar_till_postnumret?.storeId === "252500", pc.json?.notering);

  // Store ids are per chain
  const cross = await call("search", { chain: "hemkop", query: "mjölk", storeId: "2110" });
  record("willys-butik till hemköp avvisas", cross.isError && /finns inte hos Hemköp/.test(cross.text));

  // Hemköp store pinning changes prices between stores
  const a = await call("find_cheapest", { chain: "hemkop", query: "mellanmjölk", mustContain: ["mellanmjölk"], limit: 3 });
  const b = await call("find_cheapest", { chain: "hemkop", query: "mellanmjölk", mustContain: ["mellanmjölk"], limit: 3, storeId: "4146" });
  record("hemköp: butik påverkar pris", JSON.stringify(a.json?.produkter?.map((p: any) => p.price)) !== JSON.stringify(b.json?.produkter?.map((p: any) => p.price)));

  // compare_prices with a need: winner, per-chain rows, trade-off when it exists
  const cmp = await call("compare_prices", {
    query: "mellanmjölk",
    chains: CHAINS,
    stores: { coop: "252500", citygross: "3204", hemkop: "4146" },
    mustContain: ["mellanmjölk"],
    need: "3 l",
    perChain: 2,
  });
  const rows = cmp.json?.kedjor ?? [];
  record("compare_prices: alla fem kedjor svarar", rows.length === 5 && rows.every((r: any) => !r.fel), rows.map((r: any) => `${r.kedja}:${r.produkter?.[0]?.jamforpris ?? r.fel}`).join(" | "));
  const perL = rows.flatMap((r: any) => (r.produkter?.[0]?.jamforpris ? [[r.kedja, parseFloat(r.produkter[0].jamforpris)]] : []));
  const lowest = perL.sort((x: any, y: any) => x[1] - y[1])[0];
  record("compare_prices: billigast är verkligen lägst", cmp.json?.billigast?.kedja === lowest?.[0], `${cmp.json?.billigast?.kedja} ${cmp.json?.billigast?.jamforpris}`);
  record("compare_prices: kostnad för behov per kedja", rows.every((r: any) => r.produkter?.[0]?.kostnad_for_behov > 0));
  record("compare_prices: under 2,5 KB", cmp.text.length < 2500, `${cmp.text.length} tecken`);

  // Planner: chain-neutral needs, priced per chain
  await call("plan_clear", { plan: PLAN, confirm: true });
  const add = await call("plan_add_recipe", {
    plan: PLAN,
    recipe: "Pannkakor",
    ingredients: [
      { query: "ägg", amount: "6 st" },
      { query: "mellanmjölk", amount: "6 dl", mustContain: ["mellanmjölk"] },
      { query: "vetemjöl", amount: "250 g", mustContain: ["vetemjöl"] },
    ],
  });
  record("plan_add_recipe", !add.isError && add.json?.upplagda_ingredienser === 3);
  const add2 = await call("plan_add_recipe", {
    plan: PLAN,
    recipe: "Omelett",
    ingredients: [{ query: "ägg", amount: "4 st" }],
  });
  record("plan_add_recipe: andra receptet", !add2.isError);

  const totals: Record<string, number> = {};
  for (const chain of CHAINS) {
    const st = await call("plan_status", { chain, plan: PLAN, ...(STORE[chain] ? { storeId: STORE[chain] } : {}) });
    const egg = st.json?.behov?.find((l: any) => l.nyckel === "ägg");
    totals[chain] = st.json?.summa;
    record(
      `plan_status ${chain}: alla rader lösta`,
      !st.isError && st.json?.kedja === chain && st.json?.summa > 0 && /10 st/.test(egg?.behov ?? "") &&
        !st.json?.olosta_rader && (st.json?.behov ?? []).every((l: any) => l.forslag),
      `${st.json?.summa} kr · ägg → ${egg?.forslag} · ${(st.json?.behov ?? []).map((l: any) => l.forslag).join(" | ")}`,
    );
  }
  const cw = await call("plan_status", {
    chain: "willys",
    plan: PLAN,
    compareWith: ["hemkop", "coop", "citygross", "mathem"],
    compareStores: { coop: "252500", citygross: "3204", hemkop: "4146" },
  });
  record(
    "plan_status compareWith",
    (cw.json?.jamforelse ?? []).length === 5 && cw.json.jamforelse.every((j: any) => j.summa > 0 && !j.olosta_rader),
    (cw.json?.jamforelse ?? []).map((j: any) => `${j.kedja} ${j.summa ?? j.fel}`).join(" · "),
  );

  const set = await call("plan_set_ingredient", {
    plan: PLAN,
    recipe: "Pannkakor",
    ingredient: { query: "vetemjöl", amount: "500 g", mustContain: ["vetemjöl"] },
  });
  record("plan_set_ingredient", !set.isError);
  const rm = await call("plan_remove_ingredient", { plan: PLAN, recipe: "Omelett", query: "ägg" });
  record("plan_remove_ingredient", !rm.isError);
  const after = await call("plan_status", { chain: "willys", plan: PLAN });
  const egg = after.json?.behov?.find((l: any) => l.nyckel === "ägg");
  record("omräkning efter borttagning (10 → 6 ägg)", /6 st/.test(egg?.behov ?? ""), egg?.behov);

  // plan_apply as a dry run needs a Willys session
  const login = await call("login", { chain: "willys" });
  const sid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(login.text)?.[1];
  record("login willys", Boolean(sid), sid ? "ok" : login.text);
  if (sid) {
    const dry = await call("plan_apply", { chain: "willys", sessionId: sid, plan: PLAN, dryRun: true, acceptSurplus: ["*"] });
    record("plan_apply torrkörning", !dry.isError && /TORRKÖRNING/.test(dry.json?.lage ?? ""), `${dry.json?.andringar?.length} ändringar, ${dry.json?.berakn_summa} kr`);
    const ownStore = await call("search", { chain: "willys", sessionId: sid, query: "kaffe", size: 2 });
    record("search med session", !ownStore.isError);
    const wrong = await call("plan_apply", { chain: "coop", sessionId: sid, plan: PLAN, dryRun: true });
    record("plan_apply coop avvisas", wrong.isError && /stöder det/.test(wrong.text));
  }

  // Omelett's only ingredient was removed above, which removes the recipe too.
  const rr = await call("plan_remove_recipe", { plan: PLAN, recipe: "Pannkakor" });
  record("plan_remove_recipe", !rr.isError);
  const clr = await call("plan_clear", { plan: PLAN, confirm: true });
  record("plan_clear", !clr.isError);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) console.log("MISSLYCKADES:\n  " + failed.map((f) => f.name).join("\n  "));
  console.log("Plansummor:", JSON.stringify(totals));
  child.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  child.kill();
  process.exit(1);
});
