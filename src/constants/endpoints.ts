/**
 * Axfood's SAP Hybris storefront, shared by Willys and Hemköp.
 *
 * Verified 2026-10-13: every public route below answers identically on both
 * hosts — same keys in /search and /axfood/rest/p/{code}, only the prices
 * differ. So the routes are a function of the site, not two copies.
 */
export interface AxfoodSite {
  chain: "willys" | "hemkop";
  /** For error text the model reads. */
  label: string;
  base: string;
  /** The segment in axfoodcommercewebservices/v2/{cmsSite}. */
  cmsSite: string;
}

export const WILLYS: AxfoodSite = {
  chain: "willys",
  label: "Willys",
  base: "https://www.willys.se",
  cmsSite: "willys",
};

export const HEMKOP: AxfoodSite = {
  chain: "hemkop",
  label: "Hemköp",
  base: "https://www.hemkop.se",
  cmsSite: "hemkop",
};

/**
 * Verified against production 2026-07-18 with an authenticated session (Willys)
 * and 2026-10-13 anonymously (Hemköp). Status codes here are observed, not
 * assumed.
 */
export function axfoodEndpoints(site: AxfoodSite) {
  const b = site.base;
  return {
    loginPage: `${b}/anvandare/inloggning`,
    csrf: `${b}/axfood/rest/csrf-token`,
    orders: `${b}/axfood/rest/account/orders`,

    /** Line items for one order: `?q={orderId}`, grouped by category. */
    orderData: `${b}/axfood/rest/orderdata`,

    cart: `${b}/axfood/rest/cart`,
    addProducts: `${b}/axfood/rest/cart/addProducts`,
    customer: `${b}/axfood/rest/customer`,
    search: `${b}/search`,
    autocomplete: `${b}/search/autocomplete/SearchBox`,
    commonProducts: `${b}/axfoodcommercewebservices/v2/${site.cmsSite}/cms/pages`,

    /** Store-specific campaigns. `q` is the store id, e.g. 2220. */
    campaigns: `${b}/search/campaigns/online`,

    /** Category browse: `${categories}/{slug}` — same envelope as search. */
    categories: `${b}/c`,

    /**
     * Product detail over plain REST — 90 fields including ingredients,
     * nutritionFacts and labels. Prefer this over the Next.js data route
     * `_next/data/{buildId}/produktdetalj/...`, whose build id rotates on every
     * deploy and silently 404s.
     */
    product: `${b}/axfood/rest/p`,

    /** "Others also bought" recommendations for a product code. */
    othersBought: `${b}/axfood/rest/products`,

    /**
     * The whole store registry in one unauthenticated call: 259 Willys, 206
     * Hemköp (2026-10-13). Replaces the geo search `search/store?q=&lat=&lng=`,
     * which answers `results: null` on Hemköp.
     */
    storeList: `${b}/axfood/rest/store?online=false&clickAndCollect=false&b2bClickAndCollect=false`,
    /** One store: `${storeDetail}/{storeId}` — opening hours, fees, flyer. */
    storeDetail: `${b}/axfood/rest/store`,
  } as const;
}

export type AxfoodEndpoints = ReturnType<typeof axfoodEndpoints>;

/**
 * Willys routes, for the code that is still Willys-only: Puppeteer login and
 * the session probe. Everything else takes a site.
 */
export const BASE = WILLYS.base;
export const ENDPOINTS = axfoodEndpoints(WILLYS);

/**
 * Confirmed DEAD 2026-07-18 — all three answer 404 with an 80 KB HTML body.
 * Documented rather than deleted so nobody re-adds them without re-verifying.
 *
 * The offers route is the cautionary one: it embedded a Next.js build hash
 * (`a4eecdbf`) that has since rotated to `e5bbbc04`, AND the path lost its
 * `/sv` prefix. Any endpoint containing a build id is a time bomb.
 */
export const DEAD_ENDPOINTS = {
  deliverySlots: `${BASE}/axfood/rest/tms/delivery-slots`,
  pickupSlots: `${BASE}/axfood/rest/pickup-slots`,
  /** Superseded by campaigns, which is store-scoped and alive. */
  offers: `${BASE}/_next/data/{buildId}/sv/erbjudanden.json`,
  /**
   * Not dead on Willys, but answers `results: null` on Hemköp with the same
   * parameters (2026-10-13). Superseded by storeList, which works on both.
   */
  storeGeoSearch: `${BASE}/axfood/rest/search/store`,
} as const;

/**
 * Coop: Hybris for e-commerce and stores-by-postcode, Loop54 behind
 * "personalization" for search, and a separate store API. All three sit behind
 * Azure APIM and need the subscription keys read from coop.se (see
 * upstream/coop/keys.ts). Mapped 2026-10-13, see docs/kedjor.md.
 */
export const COOP = {
  keyPage: "https://www.coop.se/",
  personalization: "https://external.api.coop.se/personalization",
  hybris: "https://external.api.coop.se/ecommerce/coop",
  store: "https://proxy.api.coop.se/external/store",
  /** The query string every personalization call carries besides `store`. */
  searchParams: "api-version=v2&groups=CUSTOMER_PRIVATE&device=desktop&direct=false",
} as const;
