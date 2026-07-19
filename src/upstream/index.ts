/**
 * Willys HTTP clients, one module per resource.
 *
 * These were a single `client.ts` mixing search, cart, orders, customer,
 * products and campaigns. The split is by resource rather than by layer so that
 * a change to one Willys surface touches exactly one file.
 *
 * `cheapest.ts` and `stores.ts` sit alongside these but are deliberately not
 * re-exported here: they are composed behaviours (facet ranking, cached
 * registry), not thin wrappers over one endpoint, and callers import them
 * directly to keep that distinction visible.
 */

export { getCampaigns, type CampaignResult } from "./campaigns.js";
export {
  addToCart,
  getCart,
  removeFromCart,
  type CartView,
} from "./cart.js";
export { getCustomer, type CustomerProfile } from "./customer.js";
export {
  getFrequentProducts,
  getOrderDetails,
  getOrders,
  type FrequentProduct,
  type OrderLine,
  type OrderStatus,
  type OrderSummary,
} from "./orders.js";
export { getProductDetail, type ProductDetail } from "./products.js";
export { search, searchSuggestions, type SearchPage } from "./search.js";
