/**
 * Willys' product label vocabulary.
 *
 * Surveyed from 500 products across five top-level categories (2026-07-18).
 * An earlier version of this file was written from guesswork and contained two
 * labels that do not exist upstream ("organic", "key_hole") while omitting the
 * one that matters most for meat sourcing ("meat_from_sweden"). Anything added
 * here should come from a survey, not from intuition.
 *
 * Observed frequencies out of 500:
 *   swedish_flag 164 · keyhole 155 · frozen 112 · swedish_bird 60
 *   from_sweden 45 · meat_from_sweden 38 · ecological 18 · eu_ecological 18
 *   laktosfree 14 · environmental_facet 13 · msc_fish 10 · krav 6
 *   milk_from_sweden 6 · glutenfree 6 · rainforest_alliance 3
 */

export const WILLYS_LABEL = {
  swedishFlag: "swedish_flag",
  swedishBird: "swedish_bird",
  fromSweden: "from_sweden",
  meatFromSweden: "meat_from_sweden",
  milkFromSweden: "milk_from_sweden",
  frozen: "frozen",
  keyhole: "keyhole",
  ecological: "ecological",
  euEcological: "eu_ecological",
  krav: "krav",
  lactoseFree: "laktosfree",
  glutenFree: "glutenfree",
  mscFish: "msc_fish",
  rainforestAlliance: "rainforest_alliance",
  environmental: "environmental_facet",
} as const;

/** Raw upstream label -> normalised domain flag. */
export const LABEL_TO_FLAG: Record<string, string> = {
  [WILLYS_LABEL.swedishFlag]: "svenskt",
  [WILLYS_LABEL.swedishBird]: "svensk_fagel",
  [WILLYS_LABEL.fromSweden]: "fran_sverige",
  [WILLYS_LABEL.meatFromSweden]: "svenskt_kott",
  [WILLYS_LABEL.milkFromSweden]: "svensk_mjolk",
  [WILLYS_LABEL.frozen]: "fryst",
  [WILLYS_LABEL.keyhole]: "nyckelhalet",
  [WILLYS_LABEL.ecological]: "ekologisk",
  [WILLYS_LABEL.euEcological]: "eu_ekologisk",
  [WILLYS_LABEL.krav]: "krav",
  [WILLYS_LABEL.lactoseFree]: "laktosfri",
  [WILLYS_LABEL.glutenFree]: "glutenfri",
  [WILLYS_LABEL.mscFish]: "msc",
  [WILLYS_LABEL.rainforestAlliance]: "rainforest_alliance",
  [WILLYS_LABEL.environmental]: "miljomarkt",
};

/**
 * Labels that constitute proof of Swedish origin.
 *
 * Brand and product name are deliberately excluded. Guldfågeln is a Swedish
 * producer but its products are often unlabelled; treating the brand as proof
 * would assert a fact the API never stated.
 */
export const SWEDISH_ORIGIN_LABELS: readonly string[] = [
  WILLYS_LABEL.swedishFlag,
  WILLYS_LABEL.swedishBird,
  WILLYS_LABEL.fromSweden,
  WILLYS_LABEL.meatFromSweden,
  WILLYS_LABEL.milkFromSweden,
];

/**
 * The stricter subset: meat specifically raised and slaughtered in Sweden.
 *
 * `swedish_flag` on a meat product can mean it was packed or processed here,
 * so a request for "Swedish meat" should prefer this label when it exists.
 */
export const SWEDISH_MEAT_LABELS: readonly string[] = [
  WILLYS_LABEL.meatFromSweden,
  WILLYS_LABEL.swedishBird,
];

/** Absence of a label proves nothing, hence OKAND rather than IMPORTERAD. */
export const ORIGIN = {
  swedish: "SE",
  unknown: "OKAND",
} as const;

/** Search facet exposing origin server-side. */
export const FACET_PRODUCT_LABELS = "productLabelTypes";

/**
 * Server-side sort keys, read from the `sorts` array Willys returns with every
 * search response. `compareprice:asc` ranks by price per kg/l/st across the
 * ENTIRE result set — which is what "cheapest" actually means. Sorting by
 * `price:asc` is a trap: it surfaces a 16 kr toddler meal (75 kr/kg) above a
 * 69 kr kilo of mince.
 */
export const SORT = {
  relevance: "relevance",
  popular: "ranking_int:asc",
  nameAsc: "name_text_sv:asc",
  nameDesc: "name_text_sv:desc",
  priceAsc: "price:asc",
  priceDesc: "price:desc",
  comparePriceAsc: "compareprice:asc",
  comparePriceDesc: "compareprice:desc",
} as const;

export type SortKey = (typeof SORT)[keyof typeof SORT];

/**
 * Top-level category slugs for /c/{slug}. Browsing a category is how you avoid
 * ranking a "köttfärssås" as the cheapest "köttfärs" — free-text search matches
 * the word, the category matches the goods.
 */
export const CATEGORY = {
  meat: "kott-chark-och-fagel",
  fruitVeg: "frukt-och-gront",
  dairy: "mejeri-ost-och-agg",
  pantry: "skafferi",
  bread: "brod-och-kakor",
  frozen: "fryst",
  fish: "fisk-och-skaldjur",
  vegetarian: "vegetariskt",
  snacks: "glass-godis-och-snacks",
  drinks: "dryck",
  readyMeals: "fardigmat",
  kids: "barn",
  all: "all",
} as const;

export type CategorySlug = (typeof CATEGORY)[keyof typeof CATEGORY];

/**
 * GS1 marking codes (T4028) → our flag names. Coop and City Gross both send
 * these codes; Axfood uses its own label strings (LABEL_TO_FLAG above).
 */
export const GS1_TO_FLAG: Record<string, string> = {
  FRAN_SVERIGE: "fran_sverige",
  KOTT_FRAN_SVERIGE: "svenskt_kott",
  SVENSK_FAGEL: "svensk_fagel",
  NYCKELHALET: "nyckelhalet",
  EU_ORGANIC_FARMING: "eu_ekologisk",
  KRAV_MARK: "krav",
  MSC: "msc",
};

/** GS1 codes that prove Swedish origin. City Gross also writes "Mjölk från Sverige" in plain text. */
export const GS1_SWEDISH_ORIGIN: readonly string[] = [
  "FRAN_SVERIGE",
  "KOTT_FRAN_SVERIGE",
  "SVENSK_FAGEL",
  "SVENSKT_SIGILL_NATURBETESKOTT",
  "Mjölk från Sverige",
];

/** GS1 codes that prove Swedish meat or poultry — the stricter requireSwedishMeat. */
export const GS1_SWEDISH_MEAT: readonly string[] = [
  "KOTT_FRAN_SVERIGE",
  "SVENSK_FAGEL",
  "SVENSKT_SIGILL_NATURBETESKOTT",
];
