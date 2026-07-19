import { z } from "zod";

/**
 * Upstream schemas are deliberately permissive.
 *
 * Willys adds and renames fields without notice. A strict schema would turn
 * an irrelevant upstream change into a broken server. Only fields we cannot
 * function without are required; everything else degrades to null.
 */

const looseNumber = z.union([z.number(), z.string()]).nullish();

export const UpstreamProduct = z
  .object({
    code: z.string(),
    name: z.string(),
    price: z.string().nullish(),
    priceValue: z.number().nullish(),
    comparePrice: z.string().nullish(),
    comparePriceUnit: z.string().nullish(),
    displayVolume: z.string().nullish(),
    manufacturer: z.string().nullish(),
    labels: z.array(z.string()).nullish(),
    potentialPromotions: z.array(z.unknown()).nullish(),
    savingsAmount: looseNumber,
    bargainProduct: z.boolean().nullish(),
    outOfStock: z.boolean().nullish(),
    addToCartDisabled: z.boolean().nullish(),
    incrementValue: z.number().nullish(),
  })
  .passthrough();
export type UpstreamProductT = z.infer<typeof UpstreamProduct>;

export const UpstreamPagination = z
  .object({
    pageSize: z.number(),
    currentPage: z.number(),
    numberOfPages: z.number(),
    totalNumberOfResults: z.number(),
  })
  .passthrough();

export const UpstreamSearch = z
  .object({
    results: z.array(UpstreamProduct).nullish(),
    pagination: UpstreamPagination.nullish(),
  })
  .passthrough();

export const UpstreamCart = z
  .object({
    code: z.string().nullish(),
    totalPrice: z.string().nullish(),
    totalItems: z.number().nullish(),
    totalDiscount: z.string().nullish(),
    products: z.array(UpstreamProduct.extend({
      quantity: z.number().nullish(),
      totalPrice: z.unknown().nullish(),
    })).nullish(),
  })
  .passthrough();

export const UpstreamCustomer = z
  .object({
    uid: z.string().nullish(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
  })
  .passthrough();

export const UpstreamOrder = z
  .object({
    orderNumber: z.union([z.string(), z.number()]).nullish(),
    code: z.string().nullish(),
    guid: z.string().nullish(),
    deliveryFormattedDate: z.string().nullish(),
    formattedOrderDate: z.string().nullish(),
    total: looseNumber,
    complete: z.boolean().nullish(),
    completed: z.boolean().nullish(),
  })
  .passthrough();

export const UpstreamOrders = z.array(UpstreamOrder);
