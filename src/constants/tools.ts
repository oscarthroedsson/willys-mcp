/**
 * Tool names, declared once.
 *
 * These previously appeared twice each — in the manifest and in the dispatch
 * switch. A typo in either place produced a silent fallthrough to "unknown
 * tool" with no compile-time signal. Deriving both sides from this object
 * turns that class of bug into a type error.
 */
export const TOOL = {
  readDoc: "willys_read_doc",
  releaseNotes: "willys_release_notes",
  openFile: "willys_open_file",
  fetchUrl: "willys_fetch_url",
  setup: "willys_setup",
  setupInit: "willys_setup_init",
  login: "willys_login",
  checkAuth: "willys_check_auth",
  logout: "willys_logout",
  search: "willys_search",
  getCart: "willys_get_cart",
  addToCart: "willys_add_to_cart",
  removeFromCart: "willys_remove_from_cart",
  getOrders: "willys_get_orders",
  getCustomerInfo: "willys_get_customer_info",
  searchSuggestions: "willys_search_suggestions",
  getProductDetail: "willys_get_product_detail",
  getOrderDetails: "willys_get_order_details",
  getFrequentProducts: "willys_get_frequent_products",
  findStores: "willys_find_stores",
  nearestStores: "willys_nearest_stores",
  getStore: "willys_get_store",
  refreshStores: "willys_refresh_stores",
  findCheapest: "willys_find_cheapest",
  getCampaigns: "willys_get_campaigns",

  // Meal planning: the cart as a projection of accumulated recipe needs.
  planAddRecipe: "willys_plan_add_recipe",
  planRemoveRecipe: "willys_plan_remove_recipe",
  planSetIngredient: "willys_plan_set_ingredient",
  planRemoveIngredient: "willys_plan_remove_ingredient",
  planStatus: "willys_plan_status",
  planApply: "willys_plan_apply",
  planClear: "willys_plan_clear",
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
> = {};

/** The version is read from package.json at startup (src/releases.ts), never hardcoded here. */
export const SERVER_INFO = {
  name: "willys-mcp",
  protocolVersion: "2024-11-05",
} as const;
