import { z } from "zod";
import { LIMITS, TOOL } from "../constants/index.js";
import { compact, pruneProduct } from "../mappers/prune.js";
import { WILLYS } from "../constants/index.js";
import * as api from "../upstream/axfood/index.js";
import { defineTool, respond } from "./kit.js";
import { productCode, sessionId } from "./schema-parts.js";

export const cartTools = [
  defineTool({
    name: TOOL.getCart,
    description: "Hämta kundvagnens innehåll.",
    needsAuth: true,
    schema: z.object({ sessionId }).strict(),
    async handle(_a, ctx) {
      const r = await api.getCart(WILLYS, ctx.cookies);
      return respond(r, (d) =>
        compact({
          antal: d.items,
          summa: d.total,
          rabatt: d.discount,
          varor: d.products.map((p) => ({
            ...pruneProduct(p),
            // Unit-tagged so the model never reports "900 g" as "9×".
            mangd: p.quantityDisplay,
          })),
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.addToCart,
    description: "Lägg en produkt i kundvagnen.",
    needsAuth: true,
    schema: z
      .object({
        sessionId,
        productCode,
        // Upper bound is deliberate: an unbounded quantity from a model is a
        // real-money mistake, not a validation nicety.
        quantity: z.number().int().min(LIMITS.minQuantity).max(LIMITS.maxQuantity).default(1),
      })
      .strict(),
    async handle(a, ctx) {
      const r = await api.addToCart(WILLYS, ctx.cookies, a.productCode, a.quantity);
      return respond(r, (d) => `Lade ${d.quantity} st ${d.added} i kundvagnen.`);
    },
  }),

  defineTool({
    name: TOOL.removeFromCart,
    description: "Ta bort en produkt ur kundvagnen.",
    needsAuth: true,
    schema: z.object({ sessionId, productCode }).strict(),
    async handle(a, ctx) {
      const r = await api.removeFromCart(WILLYS, ctx.cookies, a.productCode);
      return respond(r, (d) => `Tog bort ${d.removed} ur kundvagnen.`);
    },
  }),
];
