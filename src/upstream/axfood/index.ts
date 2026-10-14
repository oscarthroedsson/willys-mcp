/**
 * Axfood HTTP clients (Willys, Hemköp), one module per resource.
 *
 * Every function takes the site first: Willys and Hemköp are the same SAP
 * Hybris API on two hosts, so the routes are a function of the site rather
 * than two copies. The split is by resource rather than by layer so that a
 * change to one Axfood surface touches exactly one file.
 */

export { candidates } from "./candidates.js";
export { getCampaigns } from "./campaigns.js";
export { addToCart, getCart, removeFromCart, type CartView } from "./cart.js";
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
export { getProductDetail } from "./products.js";
export { search, searchSuggestions } from "./search.js";
export { listStores, storeDetail } from "./stores.js";
