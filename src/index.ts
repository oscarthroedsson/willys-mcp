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
import {
  addRecipe,
  clearPlan,
  listRecipes,
  removeRecipe,
} from "./planner/ledger.js";
import {
  applyPlan,
  buildPlan,
  type BuiltPlan,
  type PlanAction,
} from "./planner/reconcile.js";
import type { Measure } from "./domain/volume.js";
import {
  initEnvFile,
  inspectSetup,
  openInEditor,
  setupBlocker,
  PASSWORD_HELP,
} from "./setup.js";
import { readDoc } from "./docs.js";
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
    case TOOL.readDoc: {
      const a = args as z.infer<typeof Inputs.read_doc>;
      const r = readDoc(a.path);
      return respond(r, (doc) => doc);
    }

    case TOOL.openFile: {
      const a = args as z.infer<typeof Inputs.open_file>;
      const opened = openInEditor(a.path);
      return text(
        compact({
          fil: a.path,
          oppnad: opened,
          status: opened
            ? "Öppnad i användarens editor."
            : "Kunde inte öppna filen. Be användaren öppna den manuellt.",
        }),
      );
    }

    case TOOL.setup: {
      const r = inspectSetup();
      return text(
        compact({
          klar: r.ready,
          ...(r.ready
            ? { status: "Servern är konfigurerad och redo. Kör willys_login." }
            : {
                status: "Servern är inte konfigurerad än.",
                fil_att_fylla_i: r.envFile,
                steg: r.steps,
                ...(r.passwordHelp ? { losenordshjalp: r.passwordHelp } : {}),
                notering:
                  "Ta användaren genom uppsättningen — läs read_doc(\"help/setup.md\"). " +
                  "Öppna filen åt dem med willys_open_file. Finns losenordshjalp, " +
                  "gå igenom den först: annars letar de efter ett lösenord som " +
                  "aldrig skapats.",
              }),
          kontroller: r.checks.map((c) => ({
            kontroll: c.label,
            status: c.status,
            detalj: c.detail,
            ...(c.fix ? { atgard: c.fix } : {}),
          })),
        }),
      );
    }

    case TOOL.setupInit: {
      const a = args as z.infer<typeof Inputs.setup_init>;
      const r = initEnvFile(a.storeId);
      return text(
        compact({
          fil: r.envFile,
          skapad: r.created,
          ...(r.storeIdWritten ? { butik_ifylld: r.storeIdWritten } : {}),
          ...(r.permissionsFixed ? { rattigheter: "satta till 600" } : {}),
          kvar_att_fylla_i: r.remaining,
          ...(r.remaining.length > 0
            ? {
                nasta_steg:
                  `Öppna filen åt dem: willys_open_file med path "${r.envFile}". ` +
                  `Be dem fylla i ${r.remaining.join(" och ")} och spara — ingen ` +
                  "omstart behövs.",
                fraga_forst:
                  "Kolla först om de loggat in på willys.se med lösenord eller " +
                  "bara med BankID. Bara BankID = inget lösenord finns än. " +
                  `${PASSWORD_HELP.ifNever} ${PASSWORD_HELP.where}`,
              }
            : {}),
          notering: r.note,
        }),
      );
    }

    case TOOL.login: {
      const a = args as z.infer<typeof Inputs.login>;

      // Nothing the model can send fixes a missing password. Say so once,
      // pointing at the file, instead of failing inside Puppeteer.
      const blocker = setupBlocker();
      if (blocker) return failure(`${blocker} (SETUP_REQUIRED)`);

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

    case TOOL.planAddRecipe: {
      const a = args as z.infer<typeof Inputs.plan_add_recipe>;
      const r = addRecipe(a.plan, a.recipe, a.ingredients);
      return text(
        compact({
          plan: a.plan,
          recept: a.recipe,
          upplagda_ingredienser: r.accepted,
          ...(r.rejected.length > 0 ? { avvisade: r.rejected } : {}),
          recept_i_planen: listRecipes(a.plan),
          nasta_steg:
            "Kör willys_plan_status för att se föreslagen korg och totalkostnad.",
        }),
      );
    }

    case TOOL.planRemoveRecipe: {
      const a = args as z.infer<typeof Inputs.plan_remove_recipe>;
      const removed = removeRecipe(a.plan, a.recipe);
      if (removed === 0) {
        return failure(
          `Inget recept med namnet "${a.recipe}" i planen ${a.plan}. ` +
            `Finns: ${listRecipes(a.plan).join(", ") || "(inga)"}`,
        );
      }
      return text(
        compact({
          plan: a.plan,
          borttaget_recept: a.recipe,
          borttagna_rader: removed,
          recept_kvar: listRecipes(a.plan),
        }),
      );
    }

    case TOOL.planStatus: {
      const a = args as z.infer<typeof Inputs.plan_status>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const r = await buildPlan(c, a.plan, {
        acceptSurplus: a.acceptSurplus,
        preferTight: a.preferTight,
      });
      return respond(r, renderPlan);
    }

    case TOOL.planApply: {
      const a = args as z.infer<typeof Inputs.plan_apply>;
      const c = cookiesFor(a.sessionId);
      if (typeof c !== "string") return c;

      const built = await buildPlan(c, a.plan, {
        acceptSurplus: a.acceptSurplus,
        preferTight: a.preferTight,
      });
      if (!built.ok) return respond(built, renderPlan);

      const applied = await applyPlan(c, built.data, a.dryRun);
      return respond(applied, (d) =>
        compact({
          plan: a.plan,
          lage: d.dryRun ? "TORRKÖRNING — kundvagnen orörd" : "APPLICERAT",
          andringar: d.changes.map((ch) => ({
            vara: ch.label,
            atgard: ch.action,
            detalj: ch.detail,
            ...(ch.ok ? {} : { fel: ch.error }),
          })),
          hoppade_over: d.skipped,
          misslyckade: d.failed,
          kundvagn_fore: d.cartItemsBefore,
          ...(d.dryRun ? {} : { kundvagn_efter: d.cartItemsAfter }),
          berakn_summa: d.totalCost,
          ...(built.data.pendingDecisions > 0
            ? {
                obesvarade_beslut: built.data.pendingDecisions,
                notering:
                  "Rader med obesvarad överskottsfråga hoppades över. Svara via " +
                  "acceptSurplus eller preferTight och kör om.",
              }
            : {}),
          ...(d.dryRun
            ? {
                nasta_steg:
                  "Visa detta för användaren. Kör om med dryRun=false först efter godkännande.",
              }
            : {}),
        }),
      );
    }

    case TOOL.planClear: {
      const a = args as z.infer<typeof Inputs.plan_clear>;
      const r = clearPlan(a.plan);
      return text(
        compact({
          plan: a.plan,
          raderade_behov: r.items,
          raderade_val: r.choices,
          notering: "Kundvagnen är oförändrad.",
        }),
      );
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

/**
 * Render a plan for the model.
 *
 * Deliberately states provenance ("13 st = Mån:6 + Ons:4 + Tors:3") and the
 * action per line, so the model can explain a change rather than announce it.
 * Pending surplus questions are hoisted to their own field: they are the one
 * thing that must not scroll past unanswered.
 */
function renderPlan(d: BuiltPlan): string {
  return compact({
    plan: d.planId,
    summa: d.totalCost,
    ...(d.pendingDecisions > 0 ? { obesvarade_beslut: d.pendingDecisions } : {}),
    ...(d.unresolved > 0 ? { olosta_rader: d.unresolved } : {}),

    behov: d.lines.map((l) => ({
      nyckel: l.need.key,
      vara: l.need.label,
      behov: `${formatNeed(l.need.amount, l.need.measure)} = ${l.need.sources
        .map((s) => `${s.recipe}:${s.raw}`)
        .join(" + ")}`,
      ...(l.chosen
        ? {
            forslag: `${l.chosen.packages}× ${l.chosen.name} (${l.chosen.packSize})`,
            kostnad: l.chosen.totalCost,
            overskott: formatNeed(l.chosen.surplus, l.need.measure),
          }
        : { forslag: null }),
      atgard: describeAction(l.action),
      ...(l.decision ? { beslut_kravs: l.decision.question } : {}),
      ...(l.droppedCategory
        ? {
            varning:
              `kategorin "${l.droppedCategory.requested}" finns inte för söktermen ` +
              `och ignorerades. Giltiga: ${l.droppedCategory.available.slice(0, 8).join(", ")}`,
          }
        : {}),
    })),

    ...(d.conflicts.length > 0
      ? {
          konflikter: d.conflicts.map((c) => ({
            vara: c.label,
            problem:
              "recepten anger olika måttslag som inte går att slå ihop utan att gissa",
            varianter: c.measures.map(
              (m) => `${formatNeed(m.amount, m.measure)} (${m.recipes.join(", ")})`,
            ),
            atgard: "be användaren ange en gemensam enhet och lägg om receptet",
          })),
        }
      : {}),
  });
}

function describeAction(a: PlanAction): string {
  switch (a.kind) {
    case "none":
      return `oförändrad — ${a.reason}`;
    case "add":
      return `lägg till ${a.packages} st`;
    case "change_quantity":
      return `ändra antal ${a.from} → ${a.to}`;
    case "replace":
      return `byt ${a.fromName} → ${a.toName} (${a.packages} st)`;
    case "blocked":
      return `blockerad — ${a.reason}`;
  }
}

/** Normalised amounts are grams / millilitres / items; print them readably. */
function formatNeed(amount: number, measure: Measure): string {
  if (measure === "count") return `${Math.round(amount)} st`;
  const big = measure === "mass" ? "kg" : "l";
  const small = measure === "mass" ? "g" : "ml";
  if (amount >= 1000) {
    const v = amount / 1000;
    return `${Number.isInteger(v) ? v : v.toFixed(2)} ${big}`;
  }
  return `${Math.round(amount)} ${small}`;
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
