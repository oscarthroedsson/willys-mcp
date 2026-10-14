import { z } from "zod";
import { TOOL } from "../constants/index.js";
import { compact } from "../mappers/prune.js";
import type { Measure } from "../domain/volume.js";
import {
  addRecipe,
  clearPlan,
  listRecipes,
  removeIngredient,
  removeRecipe,
  setIngredient,
} from "../planner/ledger.js";
import {
  applyPlan,
  buildPlan,
  type BuiltPlan,
  type PlanAction,
} from "../planner/reconcile.js";
import { axfoodSite } from "../constants/index.js";
import { getAdapter } from "../chains/registry.js";
import { CHAIN_IDS, type ChainId } from "../chains/types.js";
import { defineTool, failure, refuse, respond, text } from "./kit.js";
import {
  chain,
  ingredient,
  optionalSessionId,
  planId,
  sessionId,
  storeId,
  surplusKeys,
} from "./schema-parts.js";

export const plannerTools = [
  defineTool({
    name: TOOL.planAddRecipe,
    description:
      "Lägg ett recepts ingredienser i behovsregistret. Mängder slås ihop per vara " +
      "över alla recept i planen, så tre recept som vill ha ägg blir ETT behov. " +
      "Rör inte kundvagnen — kör plan_apply för det. Kedjeoberoende: samma plan kan " +
      "prissättas i vilken kedja som helst med plan_status.",
    auth: "none",
    schema: z
      .object({
        plan: planId,
        recipe: z
          .string()
          .min(1)
          .max(80)
          .describe(
            "Receptets namn, t.ex. \"Fisksoppa måndag\". Samma namn igen ERSÄTTER " +
              "det tidigare bidraget i stället för att dubblera — använd det när " +
              "ett recept ska rättas.",
          ),
        ingredients: z.array(ingredient).min(1).max(60),
      })
      .strict(),
    handle(a) {
      const r = addRecipe(a.plan, a.recipe, a.ingredients);
      return text(
        compact({
          plan: a.plan,
          recept: a.recipe,
          upplagda_ingredienser: r.accepted,
          ...(r.rejected.length > 0 ? { avvisade: r.rejected } : {}),
          recept_i_planen: listRecipes(a.plan),
          nasta_steg:
            "Kör plan_status för att se föreslagen korg och totalkostnad.",
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.planRemoveRecipe,
    description:
      "Ta bort ett recept ur planen. Behoven räknas om; varor som bara det receptet " +
      "krävde försvinner ur den föreslagna korgen.",
    auth: "none",
    schema: z
      .object({
        plan: planId,
        recipe: z.string().min(1).max(80).describe("Exakt receptnamn att ta bort."),
      })
      .strict(),
    handle(a) {
      const removed = removeRecipe(a.plan, a.recipe);
      if (removed === 0) {
        return failure(
          `Inget recept med namnet "${a.recipe}" i planen ${a.plan}. ` +
            `Finns: ${listRecipes(a.plan).join(", ") || "(inga)"}`,
        );
      }
      return text(
        compact({
          plan: a.plan,
          borttaget_recept: a.recipe,
          borttagna_rader: removed,
          recept_kvar: listRecipes(a.plan),
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.planSetIngredient,
    description:
      "Lägg till eller rätta EN ingrediens i ett recept utan att röra de andra. " +
      "Använd detta för att fixa en felmatchad rad (t.ex. skärpa mustContain) i " +
      "stället för att skicka om hela receptet med plan_add_recipe.",
    auth: "none",
    schema: z
      .object({
        plan: planId,
        recipe: z
          .string()
          .min(1)
          .max(80)
          .describe("Receptet ingrediensen hör till (måste redan finnas i planen)."),
        ingredient,
      })
      .strict(),
    handle(a) {
      if (!listRecipes(a.plan).includes(a.recipe)) {
        return failure(
          `Inget recept "${a.recipe}" i planen ${a.plan}. ` +
            `Finns: ${listRecipes(a.plan).join(", ") || "(inga)"}. ` +
            `Skapa det med plan_add_recipe först.`,
        );
      }
      const r = setIngredient(a.plan, a.recipe, a.ingredient);
      if (!r.ok) return failure(`Ogiltig ingrediens (INPUT) — ${r.reason}`);
      return text(
        compact({
          plan: a.plan,
          recept: a.recipe,
          uppdaterad_ingrediens: r.key,
          nasta_steg: "Kör plan_status för att se effekten på korgen.",
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.planRemoveIngredient,
    description:
      "Ta bort EN ingrediens ur ett recept (t.ex. en skafferivara användaren " +
      "redan har hemma), utan att röra receptets övriga rader.",
    auth: "none",
    schema: z
      .object({
        plan: planId,
        recipe: z.string().min(1).max(80),
        query: z
          .string()
          .min(1)
          .max(60)
          .describe("Söktermen (nyckeln) för ingrediensen som ska tas bort."),
      })
      .strict(),
    handle(a) {
      const removed = removeIngredient(a.plan, a.recipe, a.query);
      if (!removed) {
        return failure(
          `Ingen ingrediens "${a.query}" i receptet "${a.recipe}" (plan ${a.plan}).`,
        );
      }
      return text(
        compact({
          plan: a.plan,
          recept: a.recipe,
          borttagen_ingrediens: a.query,
          nasta_steg: "Kör plan_status för att se effekten.",
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.planStatus,
    description:
      "Visa vad planen kräver, vilken produkt och mängd som föreslås för varje vara, " +
      "vad det kostar, och vilka val som väntar på svar om överskott. Läser bara — " +
      "ändrar varken plan eller kundvagn. Kör detta innan plan_apply. Planen prissätts i " +
      "chain; compareWith visar vad samma plan kostar i andra kedjor.",
    auth: "optional",
    capability: "cheapest",
    validateStore: true,
    schema: z
      .object({
        chain,
        storeId,
        sessionId: optionalSessionId,
        plan: planId,
        compareWith: z
          .array(z.enum(CHAIN_IDS))
          .max(4)
          .default([])
          .describe(
            "Andra kedjor att räkna totalkostnad för, utan att ändra något. Kostar en sökning " +
              "per ingrediens och kedja. Coop kräver butik i compareStores.",
          ),
        compareStores: z
          .object(
            Object.fromEntries(CHAIN_IDS.map((c) => [c, z.string().regex(/^\d{3,6}$/).optional()])) as Record<
              ChainId,
              z.ZodOptional<z.ZodString>
            >,
          )
          .strict()
          .default({})
          .describe('Butik per kedja för compareWith, t.ex. { "coop": "252500" }.'),
        acceptSurplus: surplusKeys(
          "Ingrediensnycklar där du redan fått ja till det billigare valet med " +
            "överskott. De slutar fråga.",
        ),
        preferTight: surplusKeys(
          "Ingrediensnycklar där användaren sagt nej till överskott. Dyrare men " +
            "tätare förpackning väljs.",
        ),
      })
      .strict(),
    async handle(a, ctx) {
      // Without this every line fails one by one and the answer reads "0 kr,
      // 3 unresolved" — a store problem disguised as an empty shelf.
      if (ctx.adapter!.storeScope === "required" && !ctx.storeId) {
        return refuse(
          "INPUT",
          `${ctx.adapter!.displayName} kräver storeId. Fråga användaren efter postnummer och ` +
            `slå upp butiken med find_stores({ chain: "${ctx.chain}", query: postnummer }).`,
        );
      }
      const r = await buildPlan(ctx.adapter!, ctx, a.plan, {
        acceptSurplus: a.acceptSurplus,
        preferTight: a.preferTight,
      });
      if (!r.ok || a.compareWith.length === 0) return respond(r, (d) => renderPlan(d));

      const others = [...new Set(a.compareWith)].filter((c) => c !== ctx.chain);
      const totals = await Promise.all(
        others.map(async (id) => {
          const adapter = getAdapter(id);
          if (adapter.storeScope === "required" && !a.compareStores[id]) {
            return { kedja: id, fel: `kräver butik i compareStores.${id}` };
          }
          const b = await buildPlan(adapter, { cookies: "", storeId: a.compareStores[id] }, a.plan, {
            acceptSurplus: ["*"],
          });
          return b.ok
            ? { kedja: id, summa: b.data.totalCost, olosta_rader: b.data.unresolved }
            : { kedja: id, fel: `${b.kind}: ${b.message}` };
        }),
      );
      return respond(r, (d) =>
        renderPlan(d, [
          { kedja: d.chain, summa: d.totalCost, olosta_rader: d.unresolved },
          ...totals,
        ]),
      );
    },
  }),

  defineTool({
    name: TOOL.planApply,
    description:
      "Synka kundvagnen mot planen. Skickar BARA differensen: rätt vara i rätt antal " +
      "ger inget anrop, växande behov byter förpackning eller höjer antalet. " +
      "dryRun=true (default) visar ändringarna utan att röra vagnen. Kräver session för chain.",
    auth: "required",
    capability: "cart",
    schema: z
      .object({
        chain,
        sessionId,
        plan: planId,
        dryRun: z
          .boolean()
          .default(true)
          .describe(
            "true visar vad som SKULLE ändras utan att röra kundvagnen. Kör alltid " +
              "true först och visa resultatet för användaren. Sätt false endast " +
              "efter uttryckligt godkännande — det ändrar en riktig kundvagn.",
          ),
        acceptSurplus: surplusKeys(
          "Nycklar där användaren godkänt billigare val med överskott.",
        ),
        preferTight: surplusKeys("Nycklar där användaren avböjt överskott."),
        acceptMatch: z
          .array(z.string().min(1).max(60))
          .max(60)
          .default([])
          .describe(
            "Ingrediensnycklar där en osäker matchning (osaker_matchning i " +
              "plan_status) bekräftats som rätt. Utan detta hålls osäkra rader " +
              "tillbaka och läggs inte i vagnen.",
          ),
      })
      .strict(),
    async handle(a, ctx) {
      const built = await buildPlan(ctx.adapter!, ctx, a.plan, {
        acceptSurplus: a.acceptSurplus,
        preferTight: a.preferTight,
      });
      if (!built.ok) return respond(built, (d: BuiltPlan) => renderPlan(d));

      // The cart capability (checked by the dispatcher) guarantees an Axfood site.
      const site = axfoodSite(ctx.chain)!;
      const applied = await applyPlan(site, ctx.cookies, built.data, a.dryRun, a.acceptMatch);
      return respond(applied, (d) =>
        compact({
          plan: a.plan,
          lage: d.dryRun ? "TORRKÖRNING — kundvagnen orörd" : "APPLICERAT",
          andringar: d.changes.map((ch) => ({
            vara: ch.label,
            atgard: ch.action,
            detalj: ch.detail,
            ...(ch.ok ? {} : { fel: ch.error }),
          })),
          hoppade_over: d.skipped,
          misslyckade: d.failed,
          kundvagn_fore: d.cartItemsBefore,
          ...(d.dryRun ? {} : { kundvagn_efter: d.cartItemsAfter }),
          berakn_summa: d.totalCost,
          ...(built.data.pendingDecisions > 0
            ? {
                obesvarade_beslut: built.data.pendingDecisions,
                notering:
                  "Rader med obesvarad överskottsfråga hoppades över. Svara via " +
                  "acceptSurplus eller preferTight och kör om.",
              }
            : {}),
          ...(d.dryRun
            ? {
                nasta_steg:
                  "Visa detta för användaren. Kör om med dryRun=false först efter godkännande.",
              }
            : {}),
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.planClear,
    description:
      "Nollställ planen. Tömmer INTE kundvagnen — den behåller det som redan lagts i.",
    auth: "none",
    schema: z
      .object({
        plan: planId,
        confirm: z
          .literal(true)
          .describe(
            "Måste vara true. Raderar hela planen inklusive vilka produkter som " +
              "valts — kundvagnen töms dock inte.",
          ),
      })
      .strict(),
    handle(a) {
      const r = clearPlan(a.plan);
      return text(
        compact({
          plan: a.plan,
          raderade_behov: r.items,
          raderade_val: r.choices,
          notering: "Kundvagnen är oförändrad.",
        }),
      );
    },
  }),
];

/**
 * Render a plan for the model.
 *
 * Deliberately states provenance ("13 st = Mån:6 + Ons:4 + Tors:3") and the
 * action per line, so the model can explain a change rather than announce it.
 * Pending surplus questions are hoisted to their own field: they are the one
 * thing that must not scroll past unanswered.
 */
function renderPlan(d: BuiltPlan, comparison?: Array<Record<string, unknown>>): string {
  return compact({
    plan: d.planId,
    kedja: d.chain,
    summa: d.totalCost,
    ...(comparison
      ? {
          jamforelse: comparison,
          jamforelse_notering:
            "Övriga kedjors summa räknas med billigaste val per rad och utan överskottsfrågor; " +
            "rader som inte hittades ingår inte.",
        }
      : {}),
    ...(d.pendingDecisions > 0 ? { obesvarade_beslut: d.pendingDecisions } : {}),
    ...(d.unresolved > 0 ? { olosta_rader: d.unresolved } : {}),

    behov: d.lines.map((l) => ({
      nyckel: l.need.key,
      vara: l.need.label,
      behov: `${formatNeed(l.need.amount, l.need.measure)} = ${l.need.sources
        .map((s) => `${s.recipe}:${s.raw}`)
        .join(" + ")}`,
      ...(l.chosen
        ? {
            forslag: `${l.chosen.packages}× ${l.chosen.name} (${l.chosen.packSize})`,
            kostnad: l.chosen.totalCost,
            overskott: formatNeed(l.chosen.surplus, l.need.measure),
          }
        : { forslag: null }),
      atgard: describeAction(l.action),
      ...(l.uncertainMatch && l.chosen
        ? {
            osaker_matchning:
              `"${l.need.query}" gav "${l.chosen.name}" — ser fel ut. Kontrollera, ` +
              `smalna av med mustContain/mustNotContain, eller bekräfta med ` +
              `acceptMatch: ["${l.need.key}"]. Osäkra rader läggs inte i vagnen förrän de bekräftats.`,
          }
        : {}),
      ...(l.decision ? { beslut_kravs: l.decision.question } : {}),
      ...(l.converted
        ? {
            omraknat_fran_styck:
              `${l.converted.fromCount} st ≈ ${formatNeed(l.converted.grams, "mass")} ` +
              `(uppskattat ${l.converted.gramsEach} g/st)`,
          }
        : {}),
      ...(l.droppedCategory
        ? {
            varning:
              `kategorin "${l.droppedCategory.requested}" finns inte för söktermen ` +
              `och ignorerades. Giltiga: ${l.droppedCategory.available.slice(0, 8).join(", ")}`,
          }
        : {}),
    })),

    ...(d.conflicts.length > 0
      ? {
          konflikter: d.conflicts.map((c) => ({
            vara: c.label,
            problem:
              "recepten anger olika måttslag som inte går att slå ihop utan att gissa",
            varianter: c.measures.map(
              (m) => `${formatNeed(m.amount, m.measure)} (${m.recipes.join(", ")})`,
            ),
            atgard: "be användaren ange en gemensam enhet och lägg om receptet",
          })),
        }
      : {}),
  });
}

function describeAction(a: PlanAction): string {
  switch (a.kind) {
    case "none":
      return `oförändrad — ${a.reason}`;
    case "add":
      return `lägg till ${a.packages} st`;
    case "change_quantity":
      return `ändra antal ${a.from} → ${a.to}`;
    case "replace":
      return `byt ${a.fromName} → ${a.toName} (${a.packages} st)`;
    case "blocked":
      return `blockerad — ${a.reason}`;
  }
}

/** Normalised amounts are grams / millilitres / items; print them readably. */
function formatNeed(amount: number, measure: Measure): string {
  if (measure === "count") return `${Math.round(amount)} st`;
  const big = measure === "mass" ? "kg" : "l";
  const small = measure === "mass" ? "g" : "ml";
  if (amount >= 1000) {
    const v = amount / 1000;
    return `${Number.isInteger(v) ? v : v.toFixed(2)} ${big}`;
  }
  return `${Math.round(amount)} ${small}`;
}
