/**
 * Tool names, declared once.
 *
 * These previously appeared twice each — in the manifest and in the dispatch
 * switch. A typo in either place produced a silent fallthrough to "unknown
 * tool" with no compile-time signal. Deriving both sides from this object
 * turns that class of bug into a type error.
 */
export const TOOL = {
  readDoc: "read_doc",
  releaseNotes: "release_notes",
  openFile: "open_file",
  fetchUrl: "fetch_url",
  setup: "setup",
  setupInit: "setup_init",
  login: "login",
  checkAuth: "check_auth",
  logout: "logout",
  search: "search",
  searchSuggestions: "search_suggestions",
  getProduct: "get_product",
  findCheapest: "find_cheapest",
  comparePrices: "compare_prices",
  findStores: "find_stores",
  getStore: "get_store",
  getCampaigns: "get_campaigns",
  getCart: "get_cart",
  addToCart: "add_to_cart",
  removeFromCart: "remove_from_cart",
  getOrders: "get_orders",
  getCustomerInfo: "get_customer_info",
  getOrderDetails: "get_order_details",
  getFrequentProducts: "get_frequent_products",

  // Meal planning: the cart as a projection of accumulated recipe needs.
  planAddRecipe: "plan_add_recipe",
  planRemoveRecipe: "plan_remove_recipe",
  planSetIngredient: "plan_set_ingredient",
  planRemoveIngredient: "plan_remove_ingredient",
  planStatus: "plan_status",
  planApply: "plan_apply",
  planClear: "plan_clear",
} as const;

/** Plans are named so several can run in parallel (veckan, fest, storkok). */
export const DEFAULT_PLAN_ID = "standard";

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

/**
 * Tools removed or renamed in a release, kept as tombstones.
 *
 * A model that learned the old surface will keep calling the old name. Without
 * this it gets "Okänt verktyg" and has to guess; with it the dispatcher answers
 * with the replacement and the version that changed it. Tombstones are never
 * advertised in tools/list — they exist only to redirect a stale call. Keep an
 * entry for at least one major version after the removal.
 */
export const RETIRED_TOOLS: Record<
  string,
  { replacement: string | null; since: string; note: string }
> = {
  ...renamedInV2(),
  willys_nearest_stores: {
    replacement: TOOL.findStores,
    since: "2.0.0",
    note: 'Ange chain och lat/lng: find_stores({ chain: "willys", lat, lng }).',
  },
  willys_refresh_stores: {
    replacement: TOOL.findStores,
    since: "2.0.0",
    note: 'Registret förnyas automatiskt efter 7 dagar; tvinga med find_stores({ chain, query, refresh: true }).',
  },
};

/**
 * 2.0.0 dropped the willys_ prefix and made `chain` a required argument. Every
 * old name maps to its new one; the note tells the model how to rewrite the
 * call, which is the only thing it needs.
 */
function renamedInV2(): Record<string, { replacement: string; since: string; note: string }> {
  const old: Record<string, string> = {
    willys_read_doc: TOOL.readDoc,
    willys_release_notes: TOOL.releaseNotes,
    willys_open_file: TOOL.openFile,
    willys_fetch_url: TOOL.fetchUrl,
    willys_setup: TOOL.setup,
    willys_setup_init: TOOL.setupInit,
    willys_login: TOOL.login,
    willys_check_auth: TOOL.checkAuth,
    willys_logout: TOOL.logout,
    willys_search: TOOL.search,
    willys_search_suggestions: TOOL.searchSuggestions,
    willys_get_product_detail: TOOL.getProduct,
    willys_find_cheapest: TOOL.findCheapest,
    willys_find_stores: TOOL.findStores,
    willys_get_store: TOOL.getStore,
    willys_get_campaigns: TOOL.getCampaigns,
    willys_get_cart: TOOL.getCart,
    willys_add_to_cart: TOOL.addToCart,
    willys_remove_from_cart: TOOL.removeFromCart,
    willys_get_orders: TOOL.getOrders,
    willys_get_customer_info: TOOL.getCustomerInfo,
    willys_get_order_details: TOOL.getOrderDetails,
    willys_get_frequent_products: TOOL.getFrequentProducts,
    willys_plan_add_recipe: TOOL.planAddRecipe,
    willys_plan_remove_recipe: TOOL.planRemoveRecipe,
    willys_plan_set_ingredient: TOOL.planSetIngredient,
    willys_plan_remove_ingredient: TOOL.planRemoveIngredient,
    willys_plan_status: TOOL.planStatus,
    willys_plan_apply: TOOL.planApply,
    willys_plan_clear: TOOL.planClear,
  };
  const chainless = new Set<string>([
    TOOL.readDoc, TOOL.releaseNotes, TOOL.openFile, TOOL.fetchUrl, TOOL.setup,
    TOOL.setupInit, TOOL.checkAuth, TOOL.logout, TOOL.planAddRecipe,
    TOOL.planRemoveRecipe, TOOL.planSetIngredient, TOOL.planRemoveIngredient, TOOL.planClear,
  ]);
  return Object.fromEntries(
    Object.entries(old).map(([name, replacement]) => [
      name,
      {
        replacement,
        since: "2.0.0",
        note: chainless.has(replacement)
          ? "Samma argument som förut."
          : 'Lägg till chain: "willys" för samma beteende som förut.',
      },
    ]),
  );
}

/** The version is read from package.json at startup (src/releases.ts), never hardcoded here. */
export const SERVER_INFO = {
  name: "willys-mcp",
  protocolVersion: "2024-11-05",
} as const;
