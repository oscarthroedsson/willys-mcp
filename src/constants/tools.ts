/**
 * Tool names, declared once.
 *
 * These previously appeared twice each — in the manifest and in the dispatch
 * switch. A typo in either place produced a silent fallthrough to "unknown
 * tool" with no compile-time signal. Deriving both sides from this object
 * turns that class of bug into a type error.
 */
export const TOOL = {
  setup: "willys_setup",
  setupInit: "willys_setup_init",
  setupOpenEnv: "willys_setup_open_env",
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
  planStatus: "willys_plan_status",
  planApply: "willys_plan_apply",
  planClear: "willys_plan_clear",
} as const;

/** Plans are named so several can run in parallel (veckan, fest, storkok). */
export const DEFAULT_PLAN_ID = "standard";

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

export const SERVER_INFO = {
  name: "willys-mcp",
  version: "1.0.0",
  protocolVersion: "2024-11-05",
} as const;
