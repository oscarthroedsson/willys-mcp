import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL } from "../src/constants/index.js";

/**
 * End-to-end smoke test over real stdio JSON-RPC.
 *
 * Exercises the full stack: transport -> Zod validation -> dispatch -> HTTP.
 * Adds one item to the cart and removes it again, restoring the original state.
 * There is no checkout tool, so ordering is structurally impossible.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Case {
  name: string;
  ok: boolean;
  detail: string;
}
const results: Case[] = [];

const child = spawn("npx", ["tsx", path.join(ROOT, "src/index.ts")], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

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
    const timer = setTimeout(
      () => reject(new Error(`timeout: ${method}`)),
      120_000,
    );
    pending.set(id, (v) => {
      clearTimeout(timer);
      resolve(v);
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}

function notify(method: string): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

async function call(tool: string, args: Record<string, unknown>) {
  const r = await rpc("tools/call", { name: tool, arguments: args });
  const text: string = r?.result?.content?.[0]?.text ?? JSON.stringify(r);
  const isError: boolean = r?.result?.isError === true;
  return { text, isError };
}

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail.slice(0, 110)}`);
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  notify("notifications/initialized");

  const list = await rpc("tools/list");
  const tools: string[] = (list?.result?.tools ?? []).map(
    (t: { name: string }) => t.name,
  );
  // Compared against the declared names, not a literal: the literal (19) went
  // stale the moment a tool was added and the check failed for months.
  const declared = Object.keys(TOOL).length;
  record("tools/list", tools.length === declared, `${tools.length} av ${declared} verktyg`);
  record(
    "checkout saknas (får ej finnas)",
    !tools.some((t) => t.includes("checkout")),
    "ingen checkout-yta exponerad",
  );

  // --- login ---
  const login = await call("willys_login", {});
  const sessionId = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(login.text)?.[1] ?? "";
  record("willys_login", !login.isError && !!sessionId, sessionId || login.text);
  if (!sessionId) {
    finish();
    return;
  }

  // --- auth ---
  const auth = await call("willys_check_auth", { sessionId });
  record("willys_check_auth", !auth.isError, auth.text);

  // --- validation boundaries (must be rejected) ---
  const badCode = await call("willys_add_to_cart", {
    sessionId,
    productCode: "inte-en-kod",
    quantity: 1,
  });
  record("avvisar ogiltig produktkod", badCode.isError, badCode.text);

  const badQty = await call("willys_add_to_cart", {
    sessionId,
    productCode: "101222270_ST",
    quantity: 9999,
  });
  record("avvisar orimlig kvantitet", badQty.isError, badQty.text);

  const badSession = await call("willys_get_cart", {
    sessionId: "inte-ett-uuid",
  });
  record("avvisar ogiltigt sessionId", badSession.isError, badSession.text);

  // --- customer ---
  const cust = await call("willys_get_customer_info", { sessionId });
  record("willys_get_customer_info", !cust.isError, cust.text);

  // --- orders ---
  const orders = await call("willys_get_orders", { sessionId, limit: 3 });
  record("willys_get_orders", !orders.isError, orders.text);

  // --- search ---
  const search = await call("willys_search", {
    sessionId,
    query: "kaffe",
    size: 5,
  });
  record("willys_search", !search.isError, search.text);

  const swedish = await call("willys_search", {
    sessionId,
    query: "kycklingfile",
    size: 10,
    onlySwedish: true,
  });
  const allSwedish =
    !swedish.isError && !/"origin":"OKAND"/.test(swedish.text);
  record("willys_search onlySwedish", allSwedish, swedish.text);

  // --- newly ported read tools ---
  const sugg = await call("willys_search_suggestions", {
    sessionId,
    term: "mjol",
  });
  record("willys_search_suggestions", !sugg.isError, sugg.text);

  const detail = await call("willys_get_product_detail", {
    sessionId,
    productCode: "101222270_ST",
  });
  record("willys_get_product_detail", !detail.isError, detail.text.slice(0, 90));

  const orderId = /"id":"(\d+)"/.exec(orders.text)?.[1] ?? "";
  if (orderId) {
    const od = await call("willys_get_order_details", { sessionId, orderId });
    const hasLines = !od.isError && /antal_rader":([1-9])/.test(od.text);
    record("willys_get_order_details", hasLines, od.text.slice(0, 90));
  } else {
    record("willys_get_order_details", false, "hittade inget order-id");
  }

  const freq = await call("willys_get_frequent_products", {
    sessionId,
    scanOrders: 3,
    limit: 5,
  });
  const hasFreq = !freq.isError && /timesBought/.test(freq.text);
  record("willys_get_frequent_products", hasFreq, freq.text.slice(0, 110));

  const camp = await call("willys_get_campaigns", {
    sessionId,
    storeId: "2220",
    size: 3,
  });
  const hasCamp = !camp.isError && /"antal":\d+/.test(camp.text);
  record("willys_get_campaigns", hasCamp, camp.text.slice(0, 100));

  const cheap = await call("willys_find_cheapest", {
    sessionId,
    query: "köttfärs",
    category: "Kött",
    requireSwedishMeat: true,
    need: "1.7 kg",
    limit: 3,
  });
  const noSauce = !cheap.isError && !/Köttfärssås|Köttfärssoppa/.test(cheap.text);
  record("willys_find_cheapest (kategori sållar sås)", noSauce, cheap.text.slice(0, 110));

  // --- cart lifecycle ---
  const before = await call("willys_get_cart", { sessionId });
  const beforeCount = /"antal":(\d+)/.exec(before.text)?.[1] ?? "?";
  record("willys_get_cart (före)", !before.isError, `antal=${beforeCount}`);

  const TEST_PRODUCT = "101222270_ST"; // Kycklingfilé Svensk Fryst
  const add = await call("willys_add_to_cart", {
    sessionId,
    productCode: TEST_PRODUCT,
    quantity: 1,
  });
  record("willys_add_to_cart", !add.isError, add.text);

  const during = await call("willys_get_cart", { sessionId });
  const present = during.text.includes(TEST_PRODUCT);
  record("varan syns i kundvagnen", present, present ? "bekräftad" : during.text);

  const remove = await call("willys_remove_from_cart", {
    sessionId,
    productCode: TEST_PRODUCT,
  });
  record("willys_remove_from_cart", !remove.isError, remove.text);

  const after = await call("willys_get_cart", { sessionId });
  const afterCount = /"antal":(\d+)/.exec(after.text)?.[1] ?? "?";
  record(
    "kundvagn återställd",
    afterCount === beforeCount,
    `före=${beforeCount} efter=${afterCount}`,
  );

  // --- logout LAST, then prove the session is dead ---
  const out = await call("willys_logout", { sessionId });
  record("willys_logout", !out.isError, out.text);

  const dead = await call("willys_check_auth", { sessionId });
  record("session död efter logout", dead.isError, dead.text);

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n=== ${results.length - failed.length}/${results.length} PASS ===`,
  );
  for (const f of failed) console.log(`MISSLYCKADES: ${f.name} -> ${f.detail}`);
  console.log("SMOKE_KLAR");
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  child.kill();
  process.exit(1);
});
