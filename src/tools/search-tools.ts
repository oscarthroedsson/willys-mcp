import { z } from "zod";
import { LIMITS, TOOL } from "../constants/index.js";
import { compact, prune, pruneProduct } from "../mappers/prune.js";
import { compactProduct } from "../mappers/compact-product.js";
import { findCheapest, type CheapestOptions } from "../chains/cheapest.js";
import { getAdapter } from "../chains/registry.js";
import { CHAIN_IDS, type ChainId } from "../chains/types.js";
import { defineTool, refuse, respond } from "./kit.js";
import { chain, optionalSessionId, productCode, storeId } from "./schema-parts.js";

/** Filters shared by find_cheapest and compare_prices. */
const filters = {
  onlySwedish: z
    .boolean()
    .default(false)
    .describe("Endast produkter med verifierad svensk ursprungsmärkning"),
  requireSwedishMeat: z
    .boolean()
    .default(false)
    .describe("Striktare: kräver märkning för svenskt kött eller svensk fågel. Använd för kött."),
  excludeBrands: z
    .array(z.string().min(1).max(60))
    .max(20)
    .default([])
    .describe('Uteslut varumärken, t.ex. ["Eldorado", "Garant"]'),
  mustContain: z
    .array(z.string().min(1).max(40))
    .max(5)
    .default([])
    .describe(
      'Ord produktnamnet måste innehålla (ordgräns/suffix, inte delsträng — "smör" ' +
        'matchar inte "Smörgåsmargarin"). Skydd mot att billigaste träffen delar ett ord men inget annat.',
    ),
  mustNotContain: z
    .array(z.string().min(1).max(40))
    .max(20)
    .default([])
    .describe(
      'Uteslut namn som innehåller något av dessa (max 20), t.ex. ["margarin","picklad","sås"].',
    ),
  need: z
    .string()
    .max(40)
    .optional()
    .describe('Behov, t.ex. "1.7 kg" — ger antal paket och total kostnad'),
};

export const searchTools = [
  defineTool({
    name: TOOL.search,
    description:
      "Sök produkter i en kedja, i kedjans relevansordning. För pris eller \"billigast\" — " +
      "använd find_cheapest eller compare_prices. onlySwedish filtrerar på verifierad " +
      "märkning, inte på varumärke.",
    auth: "optional",
    capability: "search",
    validateStore: true,
    schema: z
      .object({
        chain,
        query: z.string().min(1, "query får inte vara tom").max(LIMITS.maxQueryLength),
        storeId,
        sessionId: optionalSessionId,
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
      const r = await ctx.adapter!.search(ctx, a.query, a.page, a.size);
      return respond(r, (d) => {
        let items = d.products;
        if (a.onlySwedish) items = items.filter((p) => p.origin === "SE");
        if (a.onlyBuyable) items = items.filter((p) => p.buyable);

        return compact({
          kedja: ctx.chain,
          ...(ctx.storeId ? { butik: ctx.storeId } : {}),
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
    description: "Sökförslag (autocomplete) för en term i en kedja.",
    auth: "none",
    capability: "suggestions",
    schema: z
      .object({ chain, term: z.string().min(1).max(LIMITS.maxQueryLength), storeId })
      .strict(),
    async handle(a, ctx) {
      const r = await ctx.adapter!.suggestions(ctx, a.term);
      return respond(r, (d) => compact({ kedja: ctx.chain, forslag: d }));
    },
  }),

  defineTool({
    name: TOOL.getProduct,
    description:
      "Detaljerad produktinformation (ingredienser, näringsvärden) för en produktkod i en kedja. " +
      "Koden måste komma från samma kedja: Willys/Hemköp/City Gross 101175556_ST, Coop EAN, Mathem ett tal.",
    auth: "optional",
    capability: "product",
    validateStore: true,
    schema: z.object({ chain, productCode, storeId, sessionId: optionalSessionId }).strict(),
    async handle(a, ctx) {
      const format = ctx.adapter!.productCode;
      if (!format.pattern.test(a.productCode)) return refuse("INPUT", format.hint);
      const r = await ctx.adapter!.product(ctx, a.productCode);
      return respond(r, (d) => compact({ kedja: ctx.chain, ...prune(pruneProduct(d)) }));
    },
  }),

  defineTool({
    name: TOOL.findCheapest,
    description:
      "Billigast i EN kedja: rangordnar på jämförpris (kr/kg, kr/l, kr/st) över hela träffmängden, " +
      "sorterat av servern — inte kedjans egen sortering. Jämförpriset kontrolleras mot pris ÷ " +
      "förpackning. Returnerar tillgängliga kategorier så du kan smalna av. Flera kedjor: compare_prices.",
    auth: "optional",
    capability: "cheapest",
    validateStore: true,
    schema: z
      .object({
        chain,
        query: z.string().min(0).max(LIMITS.maxQueryLength).default(""),
        storeId,
        sessionId: optionalSessionId,
        category: z
          .string()
          .min(1)
          .max(60)
          .optional()
          .describe(
            "Kategori från availableCategories i ett tidigare svar för samma kedja och fråga. " +
              "Kör först utan för att se vilka som finns — namnen skiljer mellan kedjor.",
          ),
        ...filters,
        onlyBuyable: z.boolean().default(true),
        limit: z.number().int().min(1).max(25).default(10),
      })
      .strict(),
    async handle(a, ctx) {
      const r = await findCheapest(ctx.adapter!, ctx, {
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
          kedja: ctx.chain,
          ...(ctx.storeId ? { butik: ctx.storeId } : {}),
          traffar: d.totalHits,
          granskade: d.inspected,
          ...(d.appliedCategory ? { kategori: d.appliedCategory } : {}),
          ...(a.category && !d.appliedCategory
            ? { varning: `kategorin "${a.category}" finns inte för den här frågan och ignorerades` }
            : {}),
          tillgangliga_kategorier: d.availableCategories,
          bortfiltrerade: prune(d.filteredOut),
          ...(d.note ? { notering: d.note } : {}),
          produkter: d.products.map((p) => prune(pruneProduct(p))),
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.comparePrices,
    description:
      "Jämför samma vara mellan flera kedjor i ETT anrop: billigaste matchande produkt per kedja på " +
      "jämförpris, och vilken kedja som är billigast totalt. Kedjorna frågas parallellt; en kedja som " +
      "felar rapporteras med sin felklass utan att fälla svaret. Coop kräver butik i stores.",
    auth: "none",
    schema: z
      .object({
        query: z.string().min(1).max(LIMITS.maxQueryLength),
        chains: z
          .array(z.enum(CHAIN_IDS))
          .min(1)
          .max(CHAIN_IDS.length)
          .describe("Kedjorna att jämföra, t.ex. [\"willys\",\"coop\",\"mathem\"]. Fråga användaren vilka."),
        stores: z
          .object(
            Object.fromEntries(CHAIN_IDS.map((c) => [c, z.string().regex(/^\d{3,6}$/).optional()])) as Record<
              ChainId,
              z.ZodOptional<z.ZodString>
            >,
          )
          .strict()
          .default({})
          .describe('Butik per kedja, t.ex. { "coop": "252500" }. Coop kräver en; övriga valfria.'),
        ...filters,
        perChain: z.number().int().min(1).max(3).default(2).describe("Produkter per kedja i svaret."),
      })
      .strict(),
    async handle(a) {
      const opts: CheapestOptions = {
        query: a.query,
        onlySwedish: a.onlySwedish,
        requireSwedishMeat: a.requireSwedishMeat,
        excludeBrands: a.excludeBrands,
        onlyBuyable: true,
        mustContain: a.mustContain,
        mustNotContain: a.mustNotContain,
        need: a.need,
        limit: a.perChain,
      };
      const chains = [...new Set(a.chains)];
      const results = await Promise.all(
        chains.map(async (id) => {
          const adapter = getAdapter(id);
          const r = await findCheapest(adapter, { cookies: "", storeId: a.stores[id] }, opts);
          return { id, adapter, r };
        }),
      );

      // Overall winner: cheapest first product in the most common compare unit.
      const firsts = results.flatMap(({ id, r }) =>
        r.ok && r.data.products[0] ? [{ id, p: r.data.products[0] }] : [],
      );
      const units = new Map<string, number>();
      for (const f of firsts) {
        if (f.p.compareUnit) units.set(f.p.compareUnit, (units.get(f.p.compareUnit) ?? 0) + 1);
      }
      const unit = [...units].sort((x, y) => y[1] - x[1])[0]?.[0];
      const comparable = firsts
        .filter((f) => f.p.compareUnit === unit && f.p.perUnit !== null)
        .sort((x, y) => x.p.perUnit! - y.p.perUnit!);
      const byCost = a.need
        ? firsts.filter((f) => f.p.estimatedCost !== null).sort((x, y) => x.p.estimatedCost! - y.p.estimatedCost!)
        : [];

      const winner = comparable[0];
      const cheapestForNeed = byCost[0];

      return {
        content: [
          {
            type: "text",
            text: compact({
              fraga: a.query,
              ...(winner
                ? {
                    billigast: {
                      kedja: winner.id,
                      namn: winner.p.name,
                      jamforpris: `${winner.p.perUnit} kr/${unit}`,
                    },
                  }
                : {}),
              // A real trade-off is reported, never settled silently: the
              // cheapest per kilo can force a bigger pack than the need.
              ...(cheapestForNeed && winner && cheapestForNeed.id !== winner.id
                ? {
                    avvagning:
                      `Billigast per ${unit} är ${winner.id}, men billigast för behovet ${a.need} är ` +
                      `${cheapestForNeed.id} (${cheapestForNeed.p.estimatedCost} kr). Fråga användaren.`,
                  }
                : {}),
              ...(firsts.length > comparable.length
                ? { notering: `Endast kr/${unit} jämförs; kedjor med annan enhet står utanför jämförelsen.` }
                : {}),
              kedjor: results.map(({ id, adapter, r }) =>
                r.ok
                  ? {
                      kedja: id,
                      ...(a.stores[id] ? { butik: a.stores[id] } : {}),
                      traffar: r.data.totalHits,
                      produkter: r.data.products.map((p) => ({
                        ...compactProduct(p),
                        ...(p.estimatedCost !== null ? { kostnad_for_behov: p.estimatedCost } : {}),
                      })),
                    }
                  : { kedja: id, fel: `${r.kind}: ${r.message}`, ...(adapter.storeScope === "required" && !a.stores[id] ? { atgard: `ange stores.${id}` } : {}) },
              ),
            }),
          },
        ],
      };
    },
  }),
];
