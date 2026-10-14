/**
 * Coop HTTP clients, one module per resource. All calls go through
 * `coopRequest`, which supplies the APIM key read lazily from coop.se.
 */

export { candidates, promotions, search, suggestions } from "./search.js";
export { getProduct } from "./products.js";
export { listStores, storeDetail, storeForPostcode } from "./stores.js";
