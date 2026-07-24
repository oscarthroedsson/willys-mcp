import { z } from "zod";
import {
  DEFAULT_PLAN_ID,
  LIMITS,
  PRODUCT_CODE_HINT,
  PRODUCT_CODE_PATTERN,
  TOOL,
} from "../constants/index.js";
import { DOCS } from "../docs.js";

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

/**
 * Named shopping plan. Several can exist side by side (veckan, fest, storkok)
 * and they never share requirements.
 */
const planId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[\w åäöÅÄÖ-]+$/, "plannamn får bara innehålla bokstäver, siffror och bindestreck")
  .default(DEFAULT_PLAN_ID)
  .describe(
    `Vilken plan behoven hör till. Default "${DEFAULT_PLAN_ID}". Använd ett eget ` +
      "namn för en separat inköpsomgång.",
  );

/** Answers to surplus questions, keyed by ingredient. */
function surplusKeys(description: string) {
  return z
    .array(z.string().min(1).max(60))
    .max(60)
    .default([])
    .describe(
      `${description} Nyckeln är ingrediensens sökterm i gemener, som den står i ` +
        "fältet nyckel i svaret från willys_plan_status.",
    );
}

export const Inputs = {
  read_doc: z
    .object({
      path: z
        .string()
        .min(1)
        .describe(
          'Sökväg till dokumentet, relativt serverns docs/-mapp, t.ex. ' +
            '"help/setup.md". Instruktionerna listar de tillgängliga.',
        ),
    })
    .strict(),

  open_file: z
    .object({
      path: z
        .string()
        .min(1)
        .describe(
          "Absolut sökväg till filen som ska öppnas i användarens standardeditor. " +
            "Använd för .env vid uppsättning — sökvägen står i svaret från " +
            "willys_setup eller willys_setup_init.",
        ),
    })
    .strict(),

  fetch_url: z
    .object({
      url: z
        .string()
        .url()
        .describe("Sidan att hämta, t.ex. en recept-URL användaren gett dig."),
      render: z
        .boolean()
        .default(false)
        .describe(
          "Tvinga en renderad webbläsare direkt. Utelämna normalt — verktyget " +
            "eskalerar själv när en vanlig hämtning ger för tunt innehåll.",
        ),
    })
    .strict(),

  setup: z.object({}).strict(),

  setup_init: z
    .object({
      storeId: z
        .string()
        .regex(/^\d{3,6}$/)
        .optional()
        .describe(
          "Butiks-id att skriva in åt användaren. Slå upp det med " +
            "willys_find_stores först — fråga vilken ort de bor i, visa " +
            "träffarna och låt dem välja. Utelämna om de inte vill välja butik än.",
        ),
    })
    .strict(),

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

  // --- Måltidsplanering ------------------------------------------------------

  plan_add_recipe: z
    .object({
      sessionId,
      plan: planId,
      recipe: z
        .string()
        .min(1)
        .max(80)
        .describe(
          "Receptets namn, t.ex. \"Fisksoppa måndag\". Samma namn igen ERSÄTTER " +
            "det tidigare bidraget i stället för att dubblera — använd det när " +
            "ett recept ska rättas.",
        ),
      ingredients: z
        .array(
          z
            .object({
              query: z
                .string()
                .min(1)
                .max(60)
                .describe(
                  "Sökterm för varan, t.ex. \"ägg\" eller \"vispgrädde\". Detta är " +
                    "också nyckeln behov slås ihop på — skriv samma term för samma " +
                    "vara i olika recept, annars aggregeras de inte.",
                ),
              amount: z
                .string()
                .min(1)
                .max(30)
                .describe(
                  "Mängd med enhet: \"6 st\", \"400 g\", \"8 dl\", \"1 kg\". Ett tal " +
                    "utan enhet avvisas. Räkna om receptets mängd till portionerna " +
                    "du faktiskt lagar innan du skickar den.",
                ),
              label: z
                .string()
                .max(60)
                .optional()
                .describe("Läsbar etikett för utskrift. Default: query."),
              category: z
                .string()
                .max(60)
                .optional()
                .describe(
                  "Kategorifacett från willys_find_cheapest, t.ex. \"Mejeri\". " +
                    "Kraftigt rekommenderad för varor vars namn är tvetydigt.",
                ),
              requireSwedishMeat: z
                .boolean()
                .default(false)
                .describe("Kräv svensk köttmärkning. Använd för kött och fågel."),
              mustContain: z
                .array(z.string().min(1).max(40))
                .max(5)
                .default([])
                .describe(
                  "Ord produktnamnet måste innehålla. Sätt detta när söktermen " +
                    "riskerar att matcha fel vara.",
                ),
            })
            .strict(),
        )
        .min(1)
        .max(60),
    })
    .strict(),

  plan_remove_recipe: z
    .object({
      plan: planId,
      recipe: z.string().min(1).max(80).describe("Exakt receptnamn att ta bort."),
    })
    .strict(),

  plan_status: z
    .object({
      sessionId,
      plan: planId,
      acceptSurplus: surplusKeys(
        "Ingrediensnycklar där du redan fått ja till det billigare valet med " +
          "överskott. De slutar fråga.",
      ),
      preferTight: surplusKeys(
        "Ingrediensnycklar där användaren sagt nej till överskott. Dyrare men " +
          "tätare förpackning väljs.",
      ),
    })
    .strict(),

  plan_apply: z
    .object({
      sessionId,
      plan: planId,
      dryRun: z
        .boolean()
        .default(true)
        .describe(
          "true visar vad som SKULLE ändras utan att röra kundvagnen. Kör alltid " +
            "true först och visa resultatet för användaren. Sätt false endast " +
            "efter uttryckligt godkännande — det ändrar en riktig kundvagn.",
        ),
      acceptSurplus: surplusKeys(
        "Nycklar där användaren godkänt billigare val med överskott.",
      ),
      preferTight: surplusKeys(
        "Nycklar där användaren avböjt överskott.",
      ),
    })
    .strict(),

  plan_clear: z
    .object({
      plan: planId,
      confirm: z
        .literal(true)
        .describe(
          "Måste vara true. Raderar hela planen inklusive vilka produkter som " +
            "valts — kundvagnen töms dock inte.",
        ),
    })
    .strict(),
} as const;

/**
 * Convert a Zod schema to the JSON Schema advertised to the client.
 *
 * This has to be RECURSIVE and type-accurate, not just top-level. The previous
 * version flattened everything to string/number/boolean, so `ingredients`
 * (an array of objects) was advertised as a bare string. The MCP client then
 * coerced the argument to a string before it ever reached the server, and Zod
 * rejected it with "expected array, received string" — plan_add_recipe, and
 * every tool with an array or enum field, was unusable through the protocol.
 *
 * Value constraints (regex, min/max) are deliberately omitted: they are
 * enforced by Zod at call time. The advertised schema only needs the shape.
 */
interface Unwrapped {
  inner: z.ZodTypeAny;
  optional: boolean;
  description?: string;
}

/** Peel default/optional/nullable/effects wrappers, collecting description. */
function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let cur = schema;
  let optional = false;
  let description: string | undefined;

  for (let i = 0; i < 8; i++) {
    const d = cur._def as {
      typeName?: string;
      innerType?: z.ZodTypeAny;
      schema?: z.ZodTypeAny;
      description?: string;
    };
    description ??= d.description;

    if (d.typeName === "ZodDefault" || d.typeName === "ZodOptional") {
      optional = true;
      cur = d.innerType!;
    } else if (d.typeName === "ZodNullable") {
      cur = d.innerType!;
    } else if (d.typeName === "ZodEffects") {
      cur = d.schema!; // .refine()/.transform() wrapper
    } else {
      break;
    }
  }

  return description === undefined
    ? { inner: cur, optional }
    : { inner: cur, optional, description };
}

function toJsonNode(schema: z.ZodTypeAny): Record<string, unknown> {
  const { inner, description } = unwrap(schema);
  const d = inner._def as {
    typeName?: string;
    type?: z.ZodTypeAny;
    values?: unknown[];
    value?: unknown;
    shape?: () => Record<string, z.ZodTypeAny>;
  };

  let node: Record<string, unknown>;
  switch (d.typeName) {
    case "ZodObject": {
      const shape = d.shape!();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = toJsonNode(field);
        if (!unwrap(field).optional) required.push(key);
      }
      node = { type: "object", properties };
      if (required.length > 0) node.required = required;
      break;
    }
    case "ZodArray":
      node = { type: "array", items: toJsonNode(d.type!) };
      break;
    case "ZodNumber":
      node = { type: "number" };
      break;
    case "ZodBoolean":
      node = { type: "boolean" };
      break;
    case "ZodEnum":
      node = { type: "string", enum: d.values };
      break;
    case "ZodLiteral":
      node =
        typeof d.value === "boolean"
          ? { type: "boolean", enum: [d.value] }
          : { const: d.value };
      break;
    default:
      node = { type: "string" };
  }

  if (description !== undefined) node.description = description;
  return node;
}

/** JSON Schema advertised to the client, derived from the same Zod source. */
function jsonSchema(shape: z.ZodTypeAny): Record<string, unknown> {
  const node = toJsonNode(shape);
  // The manifest's inputSchema is always an object at the top level.
  return node.type === "object" ? node : { type: "object", properties: {} };
}

export const TOOLS = [
  {
    name: TOOL.readDoc,
    description:
      "Läs ett dokument som följer med servern (t.ex. \"help/setup.md\"). " +
      "Deterministiskt begränsad till serverns docs/-mapp — kan inte läsa .env, " +
      "sessioner eller något annat på datorn, så den är säker att anropa fritt. " +
      "De korta instruktionerna pekar hit för detaljer så de inte belastar varje session. " +
      `Tillgängliga: ${Object.keys(DOCS).join(", ")}.`,
    schema: Inputs.read_doc,
  },
  {
    name: TOOL.openFile,
    description:
      "Öppna en lokal fil i användarens standardeditor. Använd för att öppna " +
      ".env åt dem vid uppsättning — sökvägen står i svaret från willys_setup. " +
      "En chattklient gör inte filsökvägar klickbara. Läser inte innehållet.",
    schema: Inputs.open_file,
  },
  {
    name: TOOL.fetchUrl,
    description:
      "Hämta en webbsida från ANVÄNDARENS dator och få tillbaka strukturerad " +
      "data (JSON-LD, t.ex. schema.org Recipe) plus ren text. Kör detta FÖRST " +
      "när du behöver läsa en URL — det går via användarens hem-IP och tar sig " +
      "förbi block som din egen hämtning fastnar på, och det är billigare. " +
      "Faller din egen webbläsning tillbaka bara om detta misslyckas. Renderar " +
      "JS-sidor automatiskt vid behov.",
    schema: Inputs.fetch_url,
  },
  {
    name: TOOL.setup,
    description:
      "Kontrollera om servern är konfigurerad på den här datorn och få exakta " +
      "steg om något saknas, med full sökväg till filen. Kräver ingen session. " +
      "Kör detta först om willys_login svarar SETUP_REQUIRED. Se read_doc med help/setup.md.",
    schema: Inputs.setup,
  },
  {
    name: TOOL.setupInit,
    description:
      "Skapa .env åt användaren och skriv in butiks-id, med rättigheter 600. " +
      "Returnerar sökvägen till filen. Öppna den sedan med willys_open_file så " +
      "användaren kan fylla i sina uppgifter.",
    schema: Inputs.setup_init,
  },
  {
    name: TOOL.login,
    description:
      "Logga in på Willys och få ett sessionId tillbaka. Säkert att anropa: " +
      "servern läser uppgifterna ur .env, de når aldrig din kontext (se " +
      "read_doc med help/security.md). Återanvänder en giltig session (24h); force=true " +
      "tvingar ny inloggning.",
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
  {
    name: TOOL.planAddRecipe,
    description:
      "Lägg ett recepts ingredienser i behovsregistret. Mängder slås ihop per vara " +
      "över alla recept i planen, så tre recept som vill ha ägg blir ETT behov. " +
      "Rör inte kundvagnen — kör willys_plan_apply för det.",
    schema: Inputs.plan_add_recipe,
  },
  {
    name: TOOL.planRemoveRecipe,
    description:
      "Ta bort ett recept ur planen. Behoven räknas om; varor som bara det receptet " +
      "krävde försvinner ur den föreslagna korgen.",
    schema: Inputs.plan_remove_recipe,
  },
  {
    name: TOOL.planStatus,
    description:
      "Visa vad planen kräver, vilken produkt och mängd som föreslås för varje vara, " +
      "vad det kostar, och vilka val som väntar på svar om överskott. Läser bara — " +
      "ändrar varken plan eller kundvagn. Kör detta innan willys_plan_apply.",
    schema: Inputs.plan_status,
  },
  {
    name: TOOL.planApply,
    description:
      "Synka kundvagnen mot planen. Skickar BARA differensen: rätt vara i rätt antal " +
      "ger inget anrop, växande behov byter förpackning eller höjer antalet. " +
      "dryRun=true (default) visar ändringarna utan att röra vagnen.",
    schema: Inputs.plan_apply,
  },
  {
    name: TOOL.planClear,
    description:
      "Nollställ planen. Tömmer INTE kundvagnen — den behåller det som redan lagts i.",
    schema: Inputs.plan_clear,
  },
] as const;

export const toolManifest = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: jsonSchema(t.schema),
}));
