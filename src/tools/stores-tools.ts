import { z } from "zod";
import { TOOL } from "../constants/index.js";
import { compact, prune, pruneProduct } from "../mappers/prune.js";
import * as stores from "../chains/stores.js";
import type { Store } from "../chains/types.js";
import { defineTool, failure, refuse, respond } from "./kit.js";
import { chain, optionalSessionId, storeId } from "./schema-parts.js";

/** What the model needs to pick a store; coordinates and hours only on request. */
const listed = (s: Store & { distanceKm?: number }) =>
  prune({
    storeId: s.storeId,
    name: s.name,
    town: s.town,
    street: s.street,
    postalCode: s.postalCode,
    kind: s.kind,
    ecommerce: s.ecommerce,
    distanceKm: s.distanceKm,
  });

export const storesTools = [
  defineTool({
    name: TOOL.findStores,
    description:
      "Hitta butiker i en kedja: på ort, namn eller postnummer (query), eller närmast en " +
      "koordinat (lat/lng). För Coop ger ett postnummer också den e-handelsbutik som " +
      "levererar dit — det är den butiken sök och priser ska gälla. Registret cachas och " +
      "förnyas automatiskt efter en vecka. Mathem har inga butiker.",
    auth: "none",
    capability: "stores",
    schema: z
      .object({
        chain,
        query: z.string().min(1).max(80).optional().describe("Ort, butiksnamn eller postnummer"),
        lat: z.number().min(55).max(70).optional(),
        lng: z.number().min(10).max(25).optional(),
        onlyEcommerce: z
          .boolean()
          .default(false)
          .describe("Endast butiker som går att handla online från (hemleverans/upphämtning)"),
        refresh: z.boolean().default(false).describe("Hämta om registret från kedjan först"),
        limit: z.number().int().min(1).max(50).default(10),
      })
      .strict()
      .refine((a) => a.query || (a.lat !== undefined && a.lng !== undefined), {
        message: "ange query, eller både lat och lng",
      }),
    async handle(a, ctx) {
      const adapter = ctx.adapter!;
      if (a.refresh) {
        const r = await stores.refreshStores(adapter);
        if (!r.ok) return respond(r, () => "");
      }

      if (a.lat !== undefined && a.lng !== undefined) {
        const r = await stores.nearestStores(adapter, a.lat, a.lng, a.onlyEcommerce, a.limit);
        return respond(r, (d) => compact({ kedja: adapter.id, butiker: d.map(listed) }));
      }

      const query = a.query!;
      const postcode = /^\d{3}\s?\d{2}$/.test(query.trim()) ? query.replace(/\s/g, "") : null;

      // Coop: the postcode decides the e-commerce store, which is the one whose
      // assortment and prices apply. Show it first, labelled.
      let serving: Store | null = null;
      if (postcode && adapter.storeForPostcode) {
        const s = await adapter.storeForPostcode(postcode);
        if (s.ok) serving = s.data;
      }

      const r = await stores.findStores(adapter, query, a.onlyEcommerce, a.limit);
      return respond(r, (d) =>
        compact({
          kedja: adapter.id,
          ...(serving
            ? {
                levererar_till_postnumret: listed(serving),
                notering: `Använd storeId ${serving.storeId} för sök och priser hos ${adapter.displayName}.`,
              }
            : {}),
          traff: d.length,
          butiker: d.map(listed),
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.getStore,
    description:
      "Detaljer för en butik: adress, öppettider, avgifter och länk till erbjudandeblad där kedjan har det.",
    auth: "none",
    capability: "stores",
    schema: z
      .object({ chain, storeId: z.string().regex(/^\d{3,6}$/, "butiks-id är 3–6 siffror") })
      .strict(),
    async handle(a, ctx) {
      const adapter = ctx.adapter!;
      if (adapter.storeDetail) {
        const r = await adapter.storeDetail(a.storeId);
        return respond(r, (d) => compact({ kedja: adapter.id, ...prune(d) }));
      }
      // No detail route (City Gross): answer from the registry, by id.
      const r = await stores.storeById(adapter, a.storeId);
      if (!r.ok) return respond(r, () => "");
      return r.data
        ? respond({ ok: true, data: r.data }, (d) => compact({ kedja: adapter.id, ...prune(d) }))
        : refuse("NOT_FOUND", `Butiken ${a.storeId} finns inte hos ${adapter.displayName}.`);
    },
  }),

  defineTool({
    name: TOOL.getCampaigns,
    description:
      "Butikens aktuella kampanjer och erbjudanden i en kedja. För Willys tas butiken ur " +
      "WILLYS_STORE_ID i .env om storeId utelämnas.",
    auth: "optional",
    capability: "campaigns",
    validateStore: true,
    schema: z
      .object({
        chain,
        storeId,
        sessionId: optionalSessionId,
        page: z.number().int().min(0).max(50).default(0),
        size: z.number().int().min(1).max(100).default(30),
      })
      .strict(),
    async handle(a, ctx) {
      const adapter = ctx.adapter!;
      if (!ctx.storeId) {
        return failure(
          `Inget butiks-id. Ange storeId (slå upp med find_stores för ${adapter.id})` +
            (adapter.id === "willys" ? " eller sätt WILLYS_STORE_ID i .env." : "."),
        );
      }
      const r = await adapter.campaigns!(ctx, ctx.storeId, a.page, a.size);
      return respond(r, (d) =>
        compact({
          kedja: adapter.id,
          butik: d.storeId,
          antal: d.totalHits,
          produkter: d.products.map((p) => prune(pruneProduct(p))),
        }),
      );
    },
  }),
];
