import { harvestCookies, readCredentials } from "../src/auth/login.js";
import { BASE, ENDPOINTS } from "../src/constants/index.js";
import { request } from "../src/core/http.js";

/** Learn the response shapes for the four tools still to be ported. */

async function main() {
  const creds = readCredentials();
  if (!creds.ok) {
    console.log("CREDS_FEL", creds.message);
    process.exit(1);
  }
  const c = await harvestCookies(creds.data);
  if (!c.ok) {
    console.log("LOGIN_FEL", c.kind, c.message);
    process.exit(1);
  }
  const cookies = c.data;
  console.log("inloggad\n");

  // 1. autocomplete
  const ac = await request<any>(
    `${ENDPOINTS.autocomplete}?term=${encodeURIComponent("mjölk")}`,
    { cookies },
  );
  console.log("=== AUTOCOMPLETE ===");
  if (ac.ok) {
    console.log("nycklar:", Object.keys(ac.data).join(", "));
    console.log("suggestions:", JSON.stringify(ac.data.suggestions?.slice(0, 3)));
    console.log("products[0]:", JSON.stringify(ac.data.products?.[0])?.slice(0, 200));
  } else console.log(ac.kind, ac.message);

  // 2. order details — need a real order id first
  const orders = await request<any[]>(ENDPOINTS.orders, { cookies });
  const firstId = orders.ok
    ? String(orders.data[0]?.orderNumber ?? orders.data[0]?.code ?? "")
    : "";
  console.log(`\n=== ORDERDATA (id ${firstId}) ===`);
  if (firstId) {
    const od = await request<any>(
      `${BASE}/axfood/rest/orderdata?q=${firstId}`,
      { cookies },
    );
    if (od.ok) {
      console.log("nycklar:", Object.keys(od.data).slice(0, 15).join(", "));
      const cat = od.data.categoryOrderedDeliveredProducts;
      if (cat) {
        const k = Object.keys(cat);
        console.log("kategorier:", k.slice(0, 5).join(", "));
        const first = cat[k[0]!];
        console.log("första produkten:", JSON.stringify(first?.[0])?.slice(0, 250));
      }
    } else console.log(od.kind, od.message);
  }

  // 3. common products (CMS wrapper)
  console.log("\n=== MINA VANLIGASTE VAROR ===");
  const cp = await request<any>(
    `${ENDPOINTS.commonProducts}?pageType=ContentPage&pageLabelOrId=minavanligastevaror&code=&fields=DEFAULT`,
    { cookies },
  );
  if (cp.ok) {
    const json = JSON.stringify(cp.data);
    console.log("storlek:", json.length);
    // Find where product codes hide in the CMS blob.
    const codes = json.match(/"code":"\d+_[A-Z]{2}"/g);
    console.log("produktkoder funna:", codes?.length ?? 0);
    const slots = cp.data.slots;
    if (Array.isArray(slots)) {
      console.log("slots:", slots.length);
      for (const s of slots.slice(0, 8)) {
        const comps = s.components?.length ?? 0;
        console.log(`  slot ${s.position ?? "?"}: ${comps} komponenter`);
      }
    }
  } else console.log(cp.kind, cp.message);

  // 4. product detail — build id rotates, so resolve it at runtime
  console.log("\n=== BUILD ID ===");
  const html = await (await fetch(`${BASE}/`, {
    headers: { "user-agent": "Mozilla/5.0", cookie: cookies },
  })).text();
  const buildId = /"buildId":"([^"]+)"/.exec(html)?.[1];
  console.log("buildId:", buildId);

  if (buildId) {
    const url = `${BASE}/_next/data/${buildId}/produktdetalj/101222270_ST.json`;
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", cookie: cookies },
    });
    console.log("produktdetalj status:", r.status);
    if (r.ok) {
      const j: any = await r.json();
      console.log("nycklar:", Object.keys(j.pageProps ?? j).slice(0, 12).join(", "));
    }
  }

  console.log("\nSHAPE_KLAR");
  process.exit(0);
}

main().catch((e) => {
  console.log("KRASCH:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
