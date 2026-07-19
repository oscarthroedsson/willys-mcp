export const BASE = "https://www.willys.se";

/**
 * Verified against production 2026-07-18 with an authenticated session.
 * Status codes here are observed, not assumed.
 */
export const ENDPOINTS = {
  loginPage: `${BASE}/anvandare/inloggning`,
  csrf: `${BASE}/axfood/rest/csrf-token`,
  orders: `${BASE}/axfood/rest/account/orders`,
  cart: `${BASE}/axfood/rest/cart`,
  addProducts: `${BASE}/axfood/rest/cart/addProducts`,
  customer: `${BASE}/axfood/rest/customer`,
  search: `${BASE}/search`,
  autocomplete: `${BASE}/search/autocomplete/SearchBox`,
  commonProducts: `${BASE}/axfoodcommercewebservices/v2/willys/cms/pages`,

  /** Store-specific campaigns. `q` is the store id, e.g. 2220. */
  campaigns: `${BASE}/search/campaigns/online`,

  /** Category browse: `${categories}/{slug}` — same envelope as search. */
  categories: `${BASE}/c`,

  /**
   * Product detail over plain REST — 90 fields including ingredients,
   * nutritionFacts and labels. Prefer this over the Next.js data route
   * `_next/data/{buildId}/produktdetalj/...`, whose build id rotates on every
   * deploy and silently 404s.
   */
  product: `${BASE}/axfood/rest/p`,

  /** "Others also bought" recommendations for a product code. */
  othersBought: `${BASE}/axfood/rest/products`,
} as const;

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
  /** Superseded by ENDPOINTS.campaigns, which is store-scoped and alive. */
  offers: `${BASE}/_next/data/{buildId}/sv/erbjudanden.json`,
} as const;
