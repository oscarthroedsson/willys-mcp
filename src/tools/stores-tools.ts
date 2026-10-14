import { z } from "zod";
import { TOOL } from "../constants/index.js";
import { DEFAULT_STORE_ID } from "../config.js";
import { compact, prune, pruneProduct } from "../mappers/prune.js";
import { willys } from "../chains/axfood.js";
import * as stores from "../chains/stores.js";
import { defineTool, failure, respond } from "./kit.js";
import { sessionId } from "./schema-parts.js";

export const storesTools = [
  defineTool({
    name: TOOL.findStores,
    description:
      "Slå upp butiker på ort, namn eller postnummer. Läser ur lokal cache av hela kedjans register, " +
      "som hämtas om automatiskt när det är äldre än en vecka.",
    needsAuth: false, // Store lookups need no session: the registry is public.
    schema: z
      .object({
        query: z.string().min(1).max(80).describe("Ortsnamn, butiksnamn eller postnummer"),
        onlyClickAndCollect: z
          .boolean()
          .default(false)
          .describe("Endast butiker som stödjer e-handel/upphämtning"),
        limit: z.number().int().min(1).max(50).default(10),
      })
      .strict(),
    async handle(a) {
      const r = await stores.findStores(willys, a.query, a.onlyClickAndCollect, a.limit);
      return respond(r, (d) => compact({ traff: d.length, butiker: d.map(prune) }));
    },
  }),

  defineTool({
    name: TOOL.nearestStores,
    description: "Närmaste butiker till en koordinat, sorterade på avstånd.",
    needsAuth: false,
    schema: z
      .object({
        lat: z.number().min(55).max(70),
        lng: z.number().min(10).max(25),
        onlyClickAndCollect: z.boolean().default(true),
        limit: z.number().int().min(1).max(20).default(5),
      })
      .strict(),
    async handle(a) {
      const r = await stores.nearestStores(
        willys,
        a.lat,
        a.lng,
        a.onlyClickAndCollect,
        a.limit,
      );
      return respond(r, (d) => compact({ butiker: d.map(prune) }));
    },
  }),

  defineTool({
    name: TOOL.getStore,
    description:
      "Detaljer för en butik: öppettider, plockavgift, fri frakt-gräns och länk till butikens erbjudandeblad.",
    needsAuth: false,
    schema: z
      .object({ storeId: z.string().regex(/^\d{3,6}$/, "butiks-id är 3-6 siffror") })
      .strict(),
    async handle(a) {
      const r = await willys.storeDetail!(a.storeId);
      return respond(r, (d) => compact(prune(d)));
    },
  }),

  defineTool({
    name: TOOL.refreshStores,
    description: "Hämta om butiksregistret från Willys.",
    needsAuth: false,
    schema: z.object({}).strict(),
    async handle() {
      const r = await stores.refreshStores(willys);
      return respond(r, (n) => `Butiksregistret uppdaterat: ${n} butiker.`);
    },
  }),

  defineTool({
    name: TOOL.getCampaigns,
    description:
      "Butiksspecifika kampanjer och erbjudanden. Ersätter den döda get_offers.",
    needsAuth: true,
    schema: z
      .object({
        sessionId,
        storeId: z
          .string()
          .regex(/^\d{3,6}$/)
          .optional()
          .describe("Butiks-id. Utelämnas: tas från WILLYS_STORE_ID i .env."),
        page: z.number().int().min(0).max(50).default(0),
        size: z.number().int().min(1).max(100).default(30),
      })
      .strict(),
    async handle(a, ctx) {
      const storeId = a.storeId ?? DEFAULT_STORE_ID();
      if (!storeId) {
        return failure(
          "Inget butiks-id. Ange storeId eller sätt WILLYS_STORE_ID i .env " +
            "(slå upp med willys_find_stores).",
        );
      }
      const r = await willys.campaigns!(ctx, storeId, a.page, a.size);
      return respond(r, (d) =>
        compact({
          butik: d.storeId,
          antal: d.totalHits,
          produkter: d.products.map((p) => prune(pruneProduct(p))),
        }),
      );
    },
  }),
];
