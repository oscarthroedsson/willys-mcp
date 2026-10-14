import { z } from "zod";
import { axfoodSite, LIMITS, TOOL, type AxfoodSite } from "../constants/index.js";
import { compact, pruneProduct } from "../mappers/prune.js";
import * as api from "../upstream/axfood/index.js";
import { defineTool, respond, type Ctx } from "./kit.js";
import { axfoodProductCode, chain, sessionId } from "./schema-parts.js";

/**
 * Cart routes exist only on Axfood. The `cart` capability (checked by the
 * dispatcher) is what keeps other chains out; this resolves the site.
 */
function site(ctx: Ctx): AxfoodSite {
  const s = axfoodSite(ctx.chain);
  if (!s) throw new Error(`kundvagn saknas för ${ctx.chain}`);
  return s;
}

export const cartTools = [
  defineTool({
    name: TOOL.getCart,
    description: "Hämta kundvagnens innehåll. Kräver session från login för samma kedja.",
    auth: "required",
    capability: "cart",
    schema: z.object({ chain, sessionId }).strict(),
    async handle(_a, ctx) {
      const r = await api.getCart(site(ctx), ctx.cookies);
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
    description: "Lägg en produkt i kundvagnen. Det finns inget kassaverktyg — servern lägger aldrig en order.",
    auth: "required",
    capability: "cart",
    schema: z
      .object({
        chain,
        sessionId,
        productCode: axfoodProductCode,
        // Upper bound is deliberate: an unbounded quantity from a model is a
        // real-money mistake, not a validation nicety.
        quantity: z.number().int().min(LIMITS.minQuantity).max(LIMITS.maxQuantity).default(1),
      })
      .strict(),
    async handle(a, ctx) {
      const r = await api.addToCart(site(ctx), ctx.cookies, a.productCode, a.quantity);
      return respond(r, (d) => `Lade ${d.quantity} st ${d.added} i kundvagnen.`);
    },
  }),

  defineTool({
    name: TOOL.removeFromCart,
    description: "Ta bort en produkt ur kundvagnen.",
    auth: "required",
    capability: "cart",
    schema: z.object({ chain, sessionId, productCode: axfoodProductCode }).strict(),
    async handle(a, ctx) {
      const r = await api.removeFromCart(site(ctx), ctx.cookies, a.productCode);
      return respond(r, (d) => `Tog bort ${d.removed} ur kundvagnen.`);
    },
  }),
];
