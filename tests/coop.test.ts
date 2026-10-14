import { extractKeys, invalidateKeys } from "../src/upstream/coop/keys.js";
import { coopRequest } from "../src/upstream/coop/http.js";
import { toCoopProduct, type CoopItem } from "../src/upstream/coop/map.js";

/**
 * Coop adapter, offline: key extraction, key rotation, and product mapping.
 * fetch is stubbed — nothing here touches the network.
 */

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

const keyA = "a".repeat(32);
const keyB = "b".repeat(32);
const page = (k: string) =>
  `<script>window.coopSettings={"personalizationApiSubscriptionKey":"${k}",` +
  `"hybrisApiSubscriptionKey":"${k}","storeApiSubscriptionKey":"${k}"}</script>`;

// ── extractKeys ──
check("hittar nycklarna i sidtexten", extractKeys(page(keyA))?.personalization === keyA);
check("saknad nyckel → null", extractKeys('{"hybrisApiSubscriptionKey":"x"}') === null);

// ── rotation: first key is rejected, exactly one refetch, then success ──
const realFetch = globalThis.fetch;
let pageFetches = 0;
let currentKey = keyA;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://www.coop.se/") {
    pageFetches++;
    const html = page(currentKey);
    currentKey = keyB; // Coop rotated after we read it
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }
  const sent = new Headers(init?.headers).get("Ocp-Apim-Subscription-Key");
  if (sent === keyB) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ statusCode: 401 }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

invalidateKeys();
const rotated = await coopRequest<{ ok: boolean }>("personalization", "https://external.api.coop.se/x");
check("roterad nyckel → lyckas efter omhämtning", rotated.ok, rotated.ok ? "" : rotated.message);
check("exakt två sidhämtningar (först + en omhämtning)", pageFetches === 2, `fick ${pageFetches}`);

// Both keys rejected: give up after one refetch with UPSTREAM, never AUTH_EXPIRED.
pageFetches = 0;
currentKey = "c".repeat(32);
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://www.coop.se/") {
    pageFetches++;
    return new Response(page("c".repeat(32)), { status: 200 });
  }
  return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
}) as typeof fetch;
invalidateKeys();
const dead = await coopRequest("personalization", "https://external.api.coop.se/x");
check("avvisad två gånger → UPSTREAM, inte AUTH_EXPIRED", !dead.ok && dead.kind === "UPSTREAM");
check("ger upp efter en omhämtning", pageFetches === 2, `fick ${pageFetches}`);
globalThis.fetch = realFetch;

// ── mapping ──
const paprika: CoopItem = {
  ean: "2317468800003",
  name: "Paprika Röd",
  salesUnit: "Vikt",
  packageSize: 200,
  packageSizeUnit: "gram ungefärlig vikt",
  salesPriceData: { b2cPrice: 59.9 },
  piecePriceData: { b2cPrice: 11.98 },
  comparativePriceData: { b2cPrice: 59.9 },
  comparativePriceUnit: { unit: "kg" },
  navCategories: [{ name: "Paprika", superCategories: [{ name: "Grönsaker", superCategories: [{ name: "Frukt & Grönsaker" }] }] }],
};
const p = toCoopProduct(paprika)!;
check("viktvara: price är kr/kg", p.price === 59.9);
check("viktvara: packagePrice är styckpriset", p.packagePrice === 11.98);
check("viktvara: unit 'ca: 200g'", p.unit === "ca: 200g");
check("toppkategori ur navigeringen", p.category === "Frukt & Grönsaker");

// piecePriceData sometimes IS the kg price (Saltrulle Kokt, 2026-10-14).
const saltrulle = toCoopProduct({
  ean: "2097224300007", name: "Saltrulle Kokt", salesUnit: "Vikt", packageSize: 100,
  packageSizeUnit: "gram ungefärlig vikt", salesPriceData: { b2cPrice: 306.64 },
  piecePriceData: { b2cPrice: 306.64 }, comparativePriceData: { b2cPrice: 306.64 },
  comparativePriceUnit: { unit: "kg" },
})!;
check("viktvara: bitpris räknas, litar inte på piecePriceData", saltrulle.packagePrice === 30.66, String(saltrulle.packagePrice));

const multibuy = toCoopProduct({
  ean: "1", name: "Nötfärs Eko", salesUnit: "Styck", packageSize: 500, packageSizeUnit: "Gram",
  piecePriceData: { b2cPrice: 93 }, comparativePriceData: { b2cPrice: 186 },
  comparativePriceUnit: { unit: "kg" },
  onlinePromotions: [{ type: "MULTI_BUY_FIXED_PRICE", numberOfProductRequired: 2, priceData: { b2cPrice: 177 } }],
})!;
check("flerköp sänker inte priset", multibuy.price === 93 && multibuy.perUnit === 186);
check("flerköp markeras som erbjudande", multibuy.onSale);

const single = toCoopProduct({
  ean: "2", name: "Kaffe", salesUnit: "Styck", packageSize: 450, packageSizeUnit: "Gram",
  piecePriceData: { b2cPrice: 69.9 }, comparativePriceData: { b2cPrice: 155.33 },
  comparativePriceUnit: { unit: "kg" },
  onlinePromotions: [{ type: "FIXED_PRICE", numberOfProductRequired: 1, medMeraRequired: false,
    priceData: { b2cPrice: 49.9 }, comparativePrice: { b2cPrice: 110.89 } }],
})!;
check("villkorslöst erbjudande blir priset", single.price === 49.9 && single.perUnit === 110.89);
check("besparing räknas", single.saving === 20);

const member = toCoopProduct({
  ean: "3", name: "Ost", salesUnit: "Styck", piecePriceData: { b2cPrice: 100 },
  comparativePriceData: { b2cPrice: 100 }, comparativePriceUnit: { unit: "kg" },
  onlinePromotions: [{ type: "FIXED_PRICE", numberOfProductRequired: 1, medMeraRequired: true, priceData: { b2cPrice: 80 } }],
})!;
check("medlemspris sänker inte priset", member.price === 100);

const swedish = toCoopProduct({
  ean: "4", name: "Kycklingfilé", accreditedTags: [{ code: "SVENSK_FAGEL" }],
  piecePriceData: { b2cPrice: 1 }, comparativePriceUnit: { unit: "liter" },
})!;
check("SVENSK_FAGEL → swedishMeat", swedish.swedishMeat);
check("liter → l", swedish.compareUnit === "l");

console.log(failures === 0 ? "ALLA TESTER GRÖNA" : `${failures} FEL`);
process.exit(failures === 0 ? 0 : 1);
