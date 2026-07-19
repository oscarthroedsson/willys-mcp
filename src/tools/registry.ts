import { z } from "zod";
import {
  LIMITS,
  PRODUCT_CODE_HINT,
  PRODUCT_CODE_PATTERN,
  TOOL,
} from "../constants/index.js";

/**
 * Tool input contracts.
 *
 * The MCP SDK does NOT validate arguments against the JSON schema a server
 * advertises — that schema is documentation, not enforcement. The previous
 * implementation cast arguments with `as {...}` in 18 places, so an invented
 * quantity went straight into the cart payload. For add_to_cart that means
 * real groceries.
 */

const sessionId = z
  .string()
  .uuid("sessionId måste vara ett UUID från willys_login");

/** Willys product codes look like 101175556_ST or 101253220_KG. */
const productCode = z.string().regex(PRODUCT_CODE_PATTERN, PRODUCT_CODE_HINT);

export const Inputs = {
  login: z
    .object({
      force: z
        .boolean()
        .default(false)
        .describe(
          "Tvinga ny inloggning även om en giltig session finns. Använd sparsamt — Willys stryper upprepade inloggningar.",
        ),
    })
    .strict(),

  check_auth: z.object({ sessionId }).strict(),

  logout: z.object({ sessionId }).strict(),

  search: z
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

  get_cart: z.object({ sessionId }).strict(),

  add_to_cart: z
    .object({
      sessionId,
      productCode,
      // Upper bound is deliberate: an unbounded quantity from a model is a
      // real-money mistake, not a validation nicety.
      quantity: z.number().int().min(LIMITS.minQuantity).max(LIMITS.maxQuantity).default(1),
    })
    .strict(),

  remove_from_cart: z.object({ sessionId, productCode }).strict(),

  get_orders: z
    .object({
      sessionId,
      limit: z.number().int().min(1).max(LIMITS.maxOrderLimit).default(LIMITS.defaultOrderLimit),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),

  get_customer_info: z.object({ sessionId }).strict(),

  search_suggestions: z
    .object({ sessionId, term: z.string().min(1).max(LIMITS.maxQueryLength) })
    .strict(),

  get_product_detail: z.object({ sessionId, productCode }).strict(),

  get_campaigns: z
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

  get_order_details: z
    .object({ sessionId, orderId: z.string().min(1).max(40) })
    .strict(),

  get_frequent_products: z
    .object({
      sessionId,
      scanOrders: z
        .number()
        .int()
        .min(1)
        .max(LIMITS.maxOrdersToScan)
        .default(LIMITS.defaultOrdersToScan)
        .describe("Antal ordrar att gå igenom; varje order kostar ett anrop"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(LIMITS.maxFrequentProducts)
        .default(20),
    })
    .strict(),

  find_stores: z
    .object({
      query: z.string().min(1).max(80).describe("Ortsnamn, butiksnamn eller postnummer"),
      onlyClickAndCollect: z
        .boolean()
        .default(false)
        .describe("Endast butiker som stödjer e-handel/upphämtning"),
      limit: z.number().int().min(1).max(50).default(10),
    })
    .strict(),

  nearest_stores: z
    .object({
      lat: z.number().min(55).max(70),
      lng: z.number().min(10).max(25),
      onlyClickAndCollect: z.boolean().default(true),
      limit: z.number().int().min(1).max(20).default(5),
    })
    .strict(),

  get_store: z
    .object({ storeId: z.string().regex(/^\d{3,6}$/, "butiks-id är 3-6 siffror") })
    .strict(),

  refresh_stores: z.object({}).strict(),

  find_cheapest: z
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
          'Produktnamnet måste innehålla dessa ord. Skydd mot att billigaste ' +
          'träffen delar ett ord men inget annat — "torkad dragon" matchade hundtugg.',
        ),
      need: z
        .string()
        .max(40)
        .optional()
        .describe('Behov, t.ex. "1.7 kg" — ger antal paket och total kostnad'),
      limit: z.number().int().min(1).max(25).default(10),
    })
    .strict(),
} as const;

/** JSON Schema advertised to the client, derived from the same Zod source. */
function jsonSchema(shape: z.ZodTypeAny): Record<string, unknown> {
  // Minimal hand-rolled conversion: the SDK only needs property names/types
  // for display. Enforcement happens through Zod at call time.
  const def = (shape as unknown as { shape?: Record<string, z.ZodTypeAny> })
    .shape;
  if (!def) return { type: "object", properties: {} };

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(def)) {
    let f: z.ZodTypeAny = field;
    let optional = false;
    let description: string | undefined;

    // Unwrap default/optional wrappers to find the base type.
    for (let i = 0; i < 4; i++) {
      const d = f._def as { typeName?: string; innerType?: z.ZodTypeAny; description?: string };
      description ??= d.description;
      if (
        d.typeName === "ZodDefault" ||
        d.typeName === "ZodOptional" ||
        d.typeName === "ZodNullable"
      ) {
        optional = true;
        if (d.innerType) f = d.innerType;
        continue;
      }
      break;
    }

    const typeName = (f._def as { typeName?: string }).typeName;
    const jsonType =
      typeName === "ZodNumber"
        ? "number"
        : typeName === "ZodBoolean"
          ? "boolean"
          : "string";

    properties[key] = description
      ? { type: jsonType, description }
      : { type: jsonType };
    if (!optional) required.push(key);
  }

  return { type: "object", properties, required };
}

export const TOOLS = [
  {
    name: TOOL.login,
    description:
      "Logga in på Willys. Återanvänder en giltig session om en finns (de lever 24h); " +
      "sätt force=true för att tvinga ny inloggning. Läser WILLYS_USERNAME/WILLYS_PASSWORD.",
    schema: Inputs.login,
  },
  {
    name: TOOL.checkAuth,
    description: "Kontrollera om en session fortfarande är giltig.",
    schema: Inputs.check_auth,
  },
  {
    name: TOOL.logout,
    description: "Avsluta sessionen.",
    schema: Inputs.logout,
  },
  {
    name: TOOL.search,
    description:
      "Sök produkter. onlySwedish filtrerar på verifierad svensk märkning (labels), inte på varumärke.",
    schema: Inputs.search,
  },
  {
    name: TOOL.getCart,
    description: "Hämta kundvagnens innehåll.",
    schema: Inputs.get_cart,
  },
  {
    name: TOOL.addToCart,
    description: "Lägg en produkt i kundvagnen.",
    schema: Inputs.add_to_cart,
  },
  {
    name: TOOL.removeFromCart,
    description: "Ta bort en produkt ur kundvagnen.",
    schema: Inputs.remove_from_cart,
  },
  {
    name: TOOL.getOrders,
    description: "Hämta orderhistorik, sidad.",
    schema: Inputs.get_orders,
  },
  {
    name: TOOL.getCustomerInfo,
    description: "Hämta kundprofil.",
    schema: Inputs.get_customer_info,
  },
  {
    name: TOOL.searchSuggestions,
    description: "Sökförslag (autocomplete) för en term.",
    schema: Inputs.search_suggestions,
  },
  {
    name: TOOL.getProductDetail,
    description: "Detaljerad produktinformation för en artikelkod.",
    schema: Inputs.get_product_detail,
  },
  {
    name: TOOL.getOrderDetails,
    description: "Alla varurader i en tidigare order.",
    schema: Inputs.get_order_details,
  },
  {
    name: TOOL.findStores,
    description:
      "Slå upp butiker på ort, namn eller postnummer. Läser ur lokal cache (hela kedjan, 254 butiker).",
    schema: Inputs.find_stores,
  },
  {
    name: TOOL.nearestStores,
    description: "Närmaste butiker till en koordinat, sorterade på avstånd.",
    schema: Inputs.nearest_stores,
  },
  {
    name: TOOL.getStore,
    description:
      "Detaljer för en butik: öppettider, plockavgift, fri frakt-gräns och länk till butikens erbjudandeblad.",
    schema: Inputs.get_store,
  },
  {
    name: TOOL.refreshStores,
    description: "Hämta om butiksregistret från Willys.",
    schema: Inputs.refresh_stores,
  },
  {
    name: TOOL.getCampaigns,
    description:
      "Butiksspecifika kampanjer och erbjudanden. Ersätter den döda get_offers.",
    schema: Inputs.get_campaigns,
  },
  {
    name: TOOL.findCheapest,
    description:
      "Sök och rangordna på jämförpris (kr/kg, kr/l, kr/st), sorterat av Willys över hela träffmängden. " +
      "Returnerar tillgängliga kategorier så du kan smalna av — utan kategori rankas köttfärssås som köttfärs.",
    schema: Inputs.find_cheapest,
  },
  {
    name: TOOL.getFrequentProducts,
    description:
      "Vanligast köpta varor, härledda ur din faktiska orderhistorik (inte CMS-sidan, som saknar produktdata).",
    schema: Inputs.get_frequent_products,
  },
] as const;

export const toolManifest = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: jsonSchema(t.schema),
}));
