import { z } from "zod";
import { LIMITS, TOOL } from "../constants/index.js";
import { compact } from "../mappers/prune.js";
import { WILLYS } from "../constants/index.js";
import * as api from "../upstream/axfood/index.js";
import { defineTool, respond } from "./kit.js";
import { sessionId } from "./schema-parts.js";

export const ordersTools = [
  defineTool({
    name: TOOL.getOrders,
    description: "Hämta orderhistorik, sidad.",
    needsAuth: true,
    schema: z
      .object({
        sessionId,
        limit: z.number().int().min(1).max(LIMITS.maxOrderLimit).default(LIMITS.defaultOrderLimit),
        offset: z.number().int().min(0).default(0),
      })
      .strict(),
    async handle(a, ctx) {
      const r = await api.getOrders(WILLYS, ctx.cookies, a.limit, a.offset);
      return respond(r, (d) =>
        compact({
          totalt: d.total,
          visar: `${a.offset + 1}-${a.offset + d.orders.length}`,
          ordrar: d.orders,
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.getOrderDetails,
    description: "Alla varurader i en tidigare order.",
    needsAuth: true,
    schema: z
      .object({ sessionId, orderId: z.string().min(1).max(40) })
      .strict(),
    async handle(a, ctx) {
      const r = await api.getOrderDetails(WILLYS, ctx.cookies, a.orderId);
      return respond(r, (d) =>
        compact({ order: d.id, antal_rader: d.lines.length, varor: d.lines }),
      );
    },
  }),

  defineTool({
    name: TOOL.getFrequentProducts,
    description:
      "Vanligast köpta varor, härledda ur din faktiska orderhistorik (inte CMS-sidan, som saknar produktdata).",
    needsAuth: true,
    schema: z
      .object({
        sessionId,
        scanOrders: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.maxOrdersToScan)
          .default(LIMITS.defaultOrdersToScan)
          .describe("Antal ordrar att gå igenom; varje order kostar ett anrop"),
        limit: z.number().int().min(1).max(LIMITS.maxFrequentProducts).default(20),
      })
      .strict(),
    async handle(a, ctx) {
      const r = await api.getFrequentProducts(WILLYS, ctx.cookies, a.scanOrders, a.limit);
      return respond(r, (d) =>
        compact({ genomsokta_ordrar: d.scanned, varor: d.products }),
      );
    },
  }),

  defineTool({
    name: TOOL.getCustomerInfo,
    description: "Hämta kundprofil.",
    needsAuth: true,
    schema: z.object({ sessionId }).strict(),
    async handle(_a, ctx) {
      const r = await api.getCustomer(WILLYS, ctx.cookies);
      return respond(r, (d) => compact(d));
    },
  }),
];
