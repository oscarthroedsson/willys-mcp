/**
 * Input contracts. These are enforcement, not documentation — the MCP SDK does
 * not validate arguments against the schema a server advertises.
 */

/** e.g. 101175556_ST, 101253220_KG */
export const PRODUCT_CODE_PATTERN = /^\d+_[A-Z]{2}$/;
export const PRODUCT_CODE_HINT = "produktkod måste ha formen 101175556_ST";

/**
 * Personnummer with or without century (10 or 12 digits), or a 16-digit
 * Willys Plus number.
 *
 * 10 digits is verified to work in production even though Willys' own form
 * error text asks for ååååmmddxxxx. The validation only rejects what is
 * demonstrably broken — an e-mail address, which the form silently refuses to
 * submit, producing a misleading 401 downstream.
 */
export const USERNAME_PATTERN = /^\d{10}$|^\d{12}$|^\d{16}$/;

export const LIMITS = {
  /** An unbounded quantity from a model is a real-money mistake. */
  maxQuantity: 50,
  minQuantity: 1,
  maxQueryLength: 200,
  maxPageSize: 50,
  defaultPageSize: 20,
  maxPage: 500,
  maxOrderLimit: 25,
  defaultOrderLimit: 10,
  /** Each scanned order costs one request; keep the ceiling honest. */
  maxOrdersToScan: 30,
  defaultOrdersToScan: 15,
  maxFrequentProducts: 50,
} as const;

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
