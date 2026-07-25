import { z } from "zod";
import { LIMITS, TOOL } from "../constants/index.js";
import { compact, prune, pruneProduct } from "../mappers/prune.js";
import * as api from "../upstream/index.js";
import { findCheapest } from "../upstream/cheapest.js";
import { defineTool, respond } from "./kit.js";
import { productCode, sessionId } from "./schema-parts.js";

export const searchTools = [
  defineTool({
    name: TOOL.search,
    description:
      "Sök produkter. onlySwedish filtrerar på verifierad svensk märkning (labels), inte på varumärke.",
    needsAuth: true,
    schema: z
      .object({
        sessionId,
        query: z.string().min(1, "query får inte vara tom").max(LIMITS.maxQueryLength),
        page: z.number().int().min(0).max(LIMITS.maxPage).default(0),
        size: z.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.defaultPageSize),
        onlySwedish: z
          .boolean()
          .default(false)
          .describe("Behåll endast produkter med verifierad svensk märkning"),
        onlyBuyable: z.boolean().default(true),
      })
      .strict(),
    async handle(a, ctx) {
      const r = await api.search(ctx.cookies, a.query, a.page, a.size);
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
    },
  }),

  defineTool({
    name: TOOL.searchSuggestions,
    description: "Sökförslag (autocomplete) för en term.",
    needsAuth: true,
    schema: z
      .object({ sessionId, term: z.string().min(1).max(LIMITS.maxQueryLength) })
      .strict(),
    async handle(a, ctx) {
      const r = await api.searchSuggestions(ctx.cookies, a.term);
      return respond(r, (d) => compact({ forslag: d }));
    },
  }),

  defineTool({
    name: TOOL.getProductDetail,
    description: "Detaljerad produktinformation för en artikelkod.",
    needsAuth: true,
    schema: z.object({ sessionId, productCode }).strict(),
    async handle(a, ctx) {
      const r = await api.getProductDetail(ctx.cookies, a.productCode);
      return respond(r, (d) => compact(prune(pruneProduct(d))));
    },
  }),

  defineTool({
    name: TOOL.findCheapest,
    description:
      "Sök och rangordna på jämförpris (kr/kg, kr/l, kr/st), sorterat av Willys över hela träffmängden. " +
      "Returnerar tillgängliga kategorier så du kan smalna av — utan kategori rankas köttfärssås som köttfärs.",
    needsAuth: true,
    schema: z
      .object({
        sessionId,
        query: z.string().min(0).max(LIMITS.maxQueryLength).default(""),
        category: z
          .string()
          .min(1)
          .max(60)
          .optional()
          .describe(
            'Facettvärde från availableCategories, t.ex. "Kött" eller "Fågel". ' +
              "Filtreras serverside. Kör först utan för att se vilka som finns.",
          ),
        onlySwedish: z
          .boolean()
          .default(false)
          .describe("Endast produkter med verifierad svensk ursprungsmärkning"),
        requireSwedishMeat: z
          .boolean()
          .default(false)
          .describe(
            "Striktare: kräver meat_from_sweden eller swedish_bird. Använd för kött.",
          ),
        excludeBrands: z
          .array(z.string().min(1).max(60))
          .max(20)
          .default([])
          .describe('Uteslut varumärken, t.ex. ["Eldorado", "Garant"]'),
        onlyBuyable: z.boolean().default(true),
        mustContain: z
          .array(z.string().min(1).max(40))
          .max(5)
          .default([])
          .describe(
            'Ord produktnamnet måste innehålla (ordgräns/suffix, inte ' +
              'delsträng — "smör" matchar inte "Smörgåsmargarin"). Skydd mot att ' +
              'billigaste träffen delar ett ord men inget annat.',
          ),
        mustNotContain: z
          .array(z.string().min(1).max(40))
          .max(20)
          .default([])
          .describe(
            'Uteslut produkter vars namn innehåller något av dessa ord (max 20), ' +
              't.ex. ["margarin","picklad","sås","juice"]. Tar bort nära-missar som ' +
              'delar huvudordet men är fel vara.',
          ),
        need: z
          .string()
          .max(40)
          .optional()
          .describe('Behov, t.ex. "1.7 kg" — ger antal paket och total kostnad'),
        limit: z.number().int().min(1).max(25).default(10),
      })
      .strict(),
    async handle(a, ctx) {
      const r = await findCheapest(ctx.cookies, {
        query: a.query,
        category: a.category,
        onlySwedish: a.onlySwedish,
        requireSwedishMeat: a.requireSwedishMeat,
        excludeBrands: a.excludeBrands,
        onlyBuyable: a.onlyBuyable,
        mustContain: a.mustContain,
        mustNotContain: a.mustNotContain,
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
    },
  }),
];
