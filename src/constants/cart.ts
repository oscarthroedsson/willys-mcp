/**
 * Cart mutation contract.
 *
 * Willys has no dedicated delete endpoint — removal is an add with qty 0.
 * That is surprising enough that it belongs in a named constant rather than
 * as a bare 0 buried in a payload literal.
 */

export const REMOVE_QUANTITY = 0;

/** Fixed fields Willys expects on every addProducts entry. */
export const CART_ITEM_DEFAULTS = {
  pickUnit: "pieces",
  hideDiscountToolTip: false,
  noReplacementFlag: false,
} as const;

export interface CartItemPayload {
  productCodePost: string;
  qty: number;
  pickUnit: string;
  hideDiscountToolTip: boolean;
  noReplacementFlag: boolean;
}

export function cartItem(productCode: string, qty: number): CartItemPayload {
  return { productCodePost: productCode, qty, ...CART_ITEM_DEFAULTS };
}
