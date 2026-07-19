#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

import {
  harvestCookies,
  readCredentials,
  verifySession,
} from "./auth/login.js";
import {
  createSession,
  deleteSession,
  findValidSession,
  getCookies,
  purgeExpired,
} from "./auth/session.js";
import { log } from "./core/logger.js";
import { explain, type Result } from "./core/result.js";
import { compact, prune, pruneProduct } from "./mappers/prune.js";
import * as api from "./upstream/index.js";
import { findCheapest } from "./upstream/cheapest.js";
import * as stores from "./upstream/stores.js";
import { DEFAULT_STORE_ID } from "./config.js";
import {
  SERVER_INFO,
  SERVER_INSTRUCTIONS,
  TOOL,
  type ToolName,
} from "./constants/index.js";
import { Inputs, TOOLS, toolManifest } from "./tools/registry.js";

// `instructions` rides along in the SDK's own initialize response. The Protocol
// class owns that method, so this is the supported way to reach the payload —
// registering an InitializeRequestSchema handler here would collide with it.
const server = new Server(
  { name: SERVER_INFO.name, version: SERVER_INFO.version },
  {
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
  },
);

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const text = (s: string): ToolResponse => ({
  content: [{ type: "text", text: s }],
});

const failure = (s: string): ToolResponse => ({
  content: [{ type: "text", text: s }],
  isError: true,
});

/** Turn a Result into a tool response, never swallowing the error kind. */
function respond<T>(r: Result<T>, render: (v: T) => string): ToolResponse {
  if (r.ok) return text(render(r.data));
  return failure(`${explain(r.kind)} (${r.kind}) — ${r.message}`);
}

/** Resolve a session to cookies, or produce an actionable AUTH_EXPIRED. */
function cookiesFor(sessionId: string): string | ToolResponse {
  const c = getCookies(sessionId);
  if (!c) {
    return failure(
      "Sessionen har gått ut eller finns inte. Kör willys_login igen. (AUTH_EXPIRED)",
    );
  }
  return c;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolManifest,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;

  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return failure(`Okänt verktyg: ${name}`);

  // Enforcement, not documentation. The SDK does not do this for us.
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(rot)"}: ${i.message}`)
      .join("; ");
    return failure(`Ogiltiga argument (INPUT) — ${issues}`);
  }

  try {
    return await dispatch(tool.name, parsed.data as never);
  } catch (e) {
    // Last-resort boundary: an unexpected throw must not kill the transport.
    log.error("ohanterat fel i verktyg", { name, error: String(e) });
    return failure(
      `Internt fel i ${name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
});

async function dispatch(
  name: ToolName,
  args: never,
): Promise<ToolResponse> {
  switch (name) {
    case TOOL.login: {
      const a = args as z.infer<typeof Inputs.login>;

      // Re-use a live session rather than authenticating again. Willys
      // throttles repeated logins, and sessions are valid for 24 hours, so a
      // fresh Puppeteer run per call is both slow and self-defeating.
      if (!a.force) {
        const existing = findValidSession();
        if (existing) {
          // Our TTL is bookkeeping, not proof. Willys expires sessions on its
          // own schedule, so confirm upstream before handing this back —
          // otherwise the caller gets a session that reads as anonymous.
          const stillGood = await verifySession(existing.cookies);
          if (stillGood.ok) {
            return text(
              `Återanvände befintlig session: ${existing.id}\n` +
                `Sätt force=true om du behöver logga in på nytt.`,
            );
          }
          log.info(`lagrad session ${existing.id} är död uppströms, loggar in på nytt`);
          deleteSession(existing.id);
        }
      }

      const creds = readCredentials();
      if (!creds.ok) return failure(`${explain(creds.kind)} — ${creds.message}`);

      const cookies = await harvestCookies(creds.data);
      if (!cookies.ok)
        return failure(`${explain(cookies.kind)} — ${cookies.message}`);

      purgeExpired();
      const id = createSession(cookies.data);
      return text(
        `Inloggad. sessionId: ${id}\nAnvänd detta i alla efterföljande anrop. Giltig 24h.`,
      );
    }

    case TOOL.checkAuth: {
      const a = args as z.infer<typeof Inputs.check_auth>;
      return getCookies(a.sessionId)
        ? text("Sessionen är giltig.")
        : failure("Sessionen har gått ut eller finns inte. (AUTH_EXPIRED)");
    }

    case TOOL.logout: {
      const a = args as z.infer<typeof Inputs.logout>;
      deleteSession(a.sessionId);
      return text("Utloggad.");
    }

    case TOOL.search: {
      const a = args as z.infer<typeof Inputs.search>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.search(c, a.query, a.page, a.size);
      return respond(r, (d) => {
        let items = d.products;
        if (a.onlySwedish) items = items.filter((p) => p.origin === "SE");
        if (a.onlyBuyable) items = items.filter((p) => p.buyable);

        return compact({
          traff: d.total,
          sida: `${d.page + 1}/${d.pages}`,
          visade: items.length,
          ...(a.onlySwedish && items.length < d.products.length
            ? { bortfiltrerade_ej_svenskmarkta: d.products.length - items.length }
            : {}),
          produkter: items.map(pruneProduct),
        });
      });
    }

    case TOOL.getCart: {
      const a = args as z.infer<typeof Inputs.get_cart>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.getCart(c);
      return respond(r, (d) =>
        compact({
          antal: d.items,
          summa: d.total,
          rabatt: d.discount,
          varor: d.products.map((p) => ({
            ...pruneProduct(p),
            antal: p.quantity,
          })),
        }),
      );
    }

    case TOOL.addToCart: {
      const a = args as z.infer<typeof Inputs.add_to_cart>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.addToCart(c, a.productCode, a.quantity);
      return respond(r, (d) => `Lade ${d.quantity} st ${d.added} i kundvagnen.`);
    }

    case TOOL.removeFromCart: {
      const a = args as z.infer<typeof Inputs.remove_from_cart>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.removeFromCart(c, a.productCode);
      return respond(r, (d) => `Tog bort ${d.removed} ur kundvagnen.`);
    }

    case TOOL.getOrders: {
      const a = args as z.infer<typeof Inputs.get_orders>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.getOrders(c, a.limit, a.offset);
      return respond(r, (d) =>
        compact({
          totalt: d.total,
          visar: `${a.offset + 1}-${a.offset + d.orders.length}`,
          ordrar: d.orders,
        }),
      );
    }

    case TOOL.getCustomerInfo: {
      const a = args as z.infer<typeof Inputs.get_customer_info>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.getCustomer(c);
      return respond(r, (d) => compact(d));
    }

    case TOOL.searchSuggestions: {
      const a = args as z.infer<typeof Inputs.search_suggestions>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.searchSuggestions(c, a.term);
      return respond(r, (d) => compact({ forslag: d }));
    }

    case TOOL.getProductDetail: {
      const a = args as z.infer<typeof Inputs.get_product_detail>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.getProductDetail(c, a.productCode);
      return respond(r, (d) => compact(prune(pruneProduct(d))));
    }

    case TOOL.getOrderDetails: {
      const a = args as z.infer<typeof Inputs.get_order_details>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.getOrderDetails(c, a.orderId);
      return respond(r, (d) =>
        compact({ order: d.id, antal_rader: d.lines.length, varor: d.lines }),
      );
    }

    case TOOL.getFrequentProducts: {
      const a = args as z.infer<typeof Inputs.get_frequent_products>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await api.getFrequentProducts(c, a.scanOrders, a.limit);
      return respond(r, (d) =>
        compact({ genomsokta_ordrar: d.scanned, varor: d.products }),
      );
    }

    case TOOL.getCampaigns: {
      const a = args as z.infer<typeof Inputs.get_campaigns>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const storeId = a.storeId ?? DEFAULT_STORE_ID();
      if (!storeId) {
        return failure(
          "Inget butiks-id. Ange storeId eller sätt WILLYS_STORE_ID i .env " +
            "(slå upp med willys_find_stores).",
        );
      }

      const r = await api.getCampaigns(c, storeId, a.page, a.size);
      return respond(r, (d) =>
        compact({
          butik: d.storeId,
          antal: d.totalHits,
          produkter: d.products.map((p) => prune(pruneProduct(p))),
        }),
      );
    }

    case TOOL.findCheapest: {
      const a = args as z.infer<typeof Inputs.find_cheapest>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await findCheapest(c, {
        query: a.query,
        category: a.category,
        onlySwedish: a.onlySwedish,
        requireSwedishMeat: a.requireSwedishMeat,
        excludeBrands: a.excludeBrands,
        onlyBuyable: a.onlyBuyable,
        mustContain: a.mustContain,
        need: a.need,
        limit: a.limit,
      });
      return respond(r, (d) =>
        compact({
          traffar: d.totalHits,
          granskade: d.inspected,
          ...(d.appliedCategory ? { kategori: d.appliedCategory } : {}),
          tillgangliga_kategorier: d.availableCategories,
          bortfiltrerade: prune(d.filteredOut),
          ...(d.note ? { notering: d.note } : {}),
          produkter: d.products.map((p) => prune(pruneProduct(p))),
        }),
      );
    }

    // Store lookups need no session: the registry is public.
    case TOOL.findStores: {
      const a = args as z.infer<typeof Inputs.find_stores>;
      const r = await stores.findStores(a.query, a.onlyClickAndCollect, a.limit);
      return respond(r, (d) =>
        compact({ traff: d.length, butiker: d.map(prune) }),
      );
    }

    case TOOL.nearestStores: {
      const a = args as z.infer<typeof Inputs.nearest_stores>;
      const r = await stores.nearestStores(
        a.lat,
        a.lng,
        a.onlyClickAndCollect,
        a.limit,
      );
      return respond(r, (d) => compact({ butiker: d.map(prune) }));
    }

    case TOOL.getStore: {
      const a = args as z.infer<typeof Inputs.get_store>;
      const r = await stores.getStoreDetail(a.storeId);
      return respond(r, (d) => compact(prune(d)));
    }

    case TOOL.refreshStores: {
      const r = await stores.refreshStores();
      return respond(r, (n) => `Butiksregistret uppdaterat: ${n} butiker.`);
    }

    default: {
      // If a tool is added to TOOL but not handled above, `name` is no longer
      // `never` here and this line fails to compile. The switch cannot drift
      // out of sync with the manifest.
      const unhandled: never = name;
      return failure(`Okänt verktyg: ${String(unhandled)}`);
    }
  }
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("willys-mcp igång på stdio");
}

main().catch((e) => {
  log.error("kunde inte starta servern", String(e));
  process.exit(1);
});
