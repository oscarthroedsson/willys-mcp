import { ok, type Result } from "../core/result.js";
import {
  planCoverage,
  type Candidate,
  type CoverageResult,
  type CoverageStrategy,
  type SurplusDecision,
} from "../domain/coverage.js";
import type { Product } from "../domain/product.js";
import { parseVolume } from "../domain/volume.js";
import { addToCart, getCart, removeFromCart } from "../upstream/cart.js";
import { findCheapest } from "../upstream/cheapest.js";
import {
  listChoices,
  listNeeds,
  recordChoice,
  forgetChoice,
  type AggregatedNeed,
  type NeedConflict,
  type RecordedChoice,
} from "./ledger.js";

/**
 * Turn the ledger into a basket, then into the smallest set of cart changes
 * that gets from where the cart is to where the plan says it should be.
 *
 * The important property is that this is recomputed from the whole ledger every
 * time, never patched incrementally. Adding a third recipe that needs seven
 * more eggs re-runs the coverage maths on the full 13 and may well decide the
 * previously chosen 6-pack was the wrong product — that is the point.
 */

export type PlanAction =
  | { kind: "none"; reason: string }
  | { kind: "add"; code: string; name: string; packages: number }
  | {
      kind: "change_quantity";
      code: string;
      name: string;
      from: number;
      to: number;
    }
  | {
      kind: "replace";
      fromCode: string;
      fromName: string;
      toCode: string;
      toName: string;
      packages: number;
    }
  | { kind: "blocked"; reason: string };

export interface PlannedLine {
  need: AggregatedNeed;
  chosen: CoverageStrategy | null;
  coverage: CoverageResult;
  previous: RecordedChoice | null;
  action: PlanAction;
  /** Set when the cheapest route overshoots enough to deserve a human answer. */
  decision: SurplusDecision | null;
  /** Set when the stated category matched nothing and was ignored. */
  droppedCategory?: { requested: string; available: string[] };
}

export interface BuiltPlan {
  planId: string;
  lines: PlannedLine[];
  conflicts: NeedConflict[];
  /** Sum of chosen strategies, for lines that resolved to a product. */
  totalCost: number;
  /** Lines awaiting a surplus answer. */
  pendingDecisions: number;
  /** Lines that could not be resolved to any product. */
  unresolved: number;
}

export interface BuildOptions {
  /**
   * Ingredient keys where the caller has accepted the cheaper, higher-surplus
   * route. Those lines stop asking and take `cheapest`.
   */
  acceptSurplus?: string[] | undefined;
  /**
   * Prefer the tightest fit over the cheapest for these keys — the answer
   * "no, don't buy 11 spare eggs".
   */
  preferTight?: string[] | undefined;
  /** How many candidate products to consider per ingredient. */
  candidateLimit?: number | undefined;
}

interface CandidateLookup {
  candidates: Candidate[];
  /**
   * Set when the requested category matched nothing and was dropped.
   *
   * Category facets are per query: "Mejeri" is not a facet for "vispgrädde"
   * (which offers Matlagning / Allergi mejeri / Mellanmål & desserter). Passing
   * one that does not exist returns zero hits, and silently reporting "no
   * product covers this" would send the caller hunting for a stock problem that
   * is really a typo. Retry without it and say what happened.
   */
  droppedCategory?: { requested: string; available: string[] };
  /** Facets available for this query, so the caller can narrow correctly. */
  availableCategories: string[];
}

/** Willys ranks by compare price; we re-rank by what covering the need costs. */
async function candidatesFor(
  cookies: string,
  need: AggregatedNeed,
  limit: number,
): Promise<Result<CandidateLookup>> {
  const base = {
    query: need.query,
    onlySwedish: false,
    requireSwedishMeat: need.requireSwedishMeat,
    excludeBrands: [],
    onlyBuyable: true,
    mustContain: need.mustContain,
    limit,
  };

  const toCandidates = (products: Product[]): Candidate[] =>
    products.map((p) => ({
      code: p.code,
      name: p.name,
      price: p.price,
      pack: parseVolume(p.unit),
      brand: p.brand,
    }));

  const first = await findCheapest(cookies, {
    ...base,
    category: need.category ?? undefined,
  });
  if (!first.ok) return first;

  const facets = first.data.availableCategories.map((c) => c.name);

  if (first.data.products.length > 0 || !need.category) {
    return ok({
      candidates: toCandidates(first.data.products),
      availableCategories: facets,
    });
  }

  // A category that filtered everything away is almost always wrong rather than
  // a genuinely empty shelf. Try again without it before giving up.
  const retry = await findCheapest(cookies, { ...base, category: undefined });
  if (!retry.ok) return retry;

  return ok({
    candidates: toCandidates(retry.data.products),
    droppedCategory: {
      requested: need.category,
      available: retry.data.availableCategories.map((c) => c.name),
    },
    availableCategories: retry.data.availableCategories.map((c) => c.name),
  });
}

function decideAction(
  chosen: CoverageStrategy | null,
  previous: RecordedChoice | null,
  availableCategories: string[],
): PlanAction {
  if (!chosen) {
    // Name the facets that do exist. "No product covers this" on its own sends
    // the caller looking for a stock problem instead of a wrong search term.
    const hint =
      availableCategories.length > 0
        ? ` Kategorier som finns för söktermen: ${availableCategories.slice(0, 8).join(", ")}.`
        : "";
    return {
      kind: "blocked",
      reason:
        "ingen produkt kunde täcka behovet — kontrollera sökterm, kategori och måttslag." +
        hint,
    };
  }

  if (!previous) {
    return {
      kind: "add",
      code: chosen.code,
      name: chosen.name,
      packages: chosen.packages,
    };
  }

  if (previous.productCode !== chosen.code) {
    return {
      kind: "replace",
      fromCode: previous.productCode,
      fromName: previous.productName,
      toCode: chosen.code,
      toName: chosen.name,
      packages: chosen.packages,
    };
  }

  if (previous.packages !== chosen.packages) {
    return {
      kind: "change_quantity",
      code: chosen.code,
      name: chosen.name,
      from: previous.packages,
      to: chosen.packages,
    };
  }

  return { kind: "none", reason: "redan rätt produkt och antal" };
}

/**
 * Compute the basket the ledger implies, without touching the cart.
 *
 * Costs one search per distinct ingredient. Nothing is written anywhere — the
 * caller can render this, ask about surplus, and only then apply.
 */
export async function buildPlan(
  cookies: string,
  planId: string,
  opts: BuildOptions = {},
): Promise<Result<BuiltPlan>> {
  const { needs, conflicts } = listNeeds(planId);
  const previousChoices = listChoices(planId);
  const accepted = new Set(opts.acceptSurplus ?? []);
  const tight = new Set(opts.preferTight ?? []);
  const limit = opts.candidateLimit ?? 12;

  const lines: PlannedLine[] = [];
  let totalCost = 0;
  let pendingDecisions = 0;
  let unresolved = 0;

  for (const need of needs) {
    const cands = await candidatesFor(cookies, need, limit);
    const previous = previousChoices.get(need.key) ?? null;

    if (!cands.ok) {
      lines.push({
        need,
        chosen: null,
        coverage: {
          requirement: { amount: need.amount, measure: need.measure },
          best: null,
          alternatives: [],
          decision: null,
          rejected: [],
        },
        previous,
        action: { kind: "blocked", reason: `sökning misslyckades: ${cands.kind}` },
        decision: null,
      });
      unresolved++;
      continue;
    }

    const coverage = planCoverage(
      { amount: need.amount, measure: need.measure },
      cands.data.candidates,
    );

    // Resolve the surplus trade-off if the caller has already answered it.
    let chosen = coverage.best;
    let decision = coverage.decision;
    if (decision) {
      if (tight.has(need.key)) {
        chosen = decision.tightest;
        decision = null;
      } else if (accepted.has(need.key)) {
        chosen = decision.cheapest;
        decision = null;
      } else {
        pendingDecisions++;
      }
    }

    if (chosen) totalCost += chosen.totalCost;
    else unresolved++;

    lines.push({
      need,
      chosen,
      coverage,
      previous,
      action: decideAction(chosen, previous, cands.data.availableCategories),
      decision,
      ...(cands.data.droppedCategory
        ? { droppedCategory: cands.data.droppedCategory }
        : {}),
    });
  }

  return ok({
    planId,
    lines,
    conflicts,
    totalCost: Number(totalCost.toFixed(2)),
    pendingDecisions,
    unresolved,
  });
}

export interface AppliedChange {
  label: string;
  action: PlanAction["kind"];
  detail: string;
  ok: boolean;
  error?: string;
}

export interface ApplyResult {
  dryRun: boolean;
  changes: AppliedChange[];
  skipped: number;
  failed: number;
  cartItemsBefore: number | null;
  cartItemsAfter: number | null;
  totalCost: number;
}

/**
 * Bring the cart in line with the plan.
 *
 * Only differences are sent. A line already holding the right product in the
 * right quantity produces no request at all, which is what makes it safe to run
 * repeatedly as recipes accumulate.
 *
 * Lines still waiting on a surplus answer are skipped rather than guessed.
 */
export async function applyPlan(
  cookies: string,
  plan: BuiltPlan,
  dryRun: boolean,
): Promise<Result<ApplyResult>> {
  const before = await getCart(cookies);
  const changes: AppliedChange[] = [];
  let skipped = 0;
  let failed = 0;

  for (const line of plan.lines) {
    const label = line.need.label;

    if (line.decision) {
      skipped++;
      changes.push({
        label,
        action: "none",
        detail: "väntar på svar om överskott",
        ok: true,
      });
      continue;
    }

    const a = line.action;

    if (a.kind === "none" || a.kind === "blocked") {
      skipped++;
      changes.push({
        label,
        action: a.kind,
        detail: a.reason,
        ok: a.kind === "none",
      });
      if (a.kind === "blocked") failed++;
      continue;
    }

    const detail =
      a.kind === "add"
        ? `lägg ${a.packages}× ${a.name}`
        : a.kind === "change_quantity"
          ? `ändra ${a.name} från ${a.from} till ${a.to} st`
          : `byt ${a.fromName} → ${a.packages}× ${a.toName}`;

    if (dryRun) {
      changes.push({ label, action: a.kind, detail, ok: true });
      continue;
    }

    const applied = await runAction(cookies, a);
    if (!applied.ok) {
      failed++;
      changes.push({
        label,
        action: a.kind,
        detail,
        ok: false,
        error: `${applied.kind}: ${applied.message}`,
      });
      continue;
    }

    // Only record the choice once the cart actually accepted it, so a failed
    // write does not leave the ledger believing something is in the basket.
    if (line.chosen) {
      recordChoice(plan.planId, {
        key: line.need.key,
        productCode: line.chosen.code,
        productName: line.chosen.name,
        packages: line.chosen.packages,
        totalCost: line.chosen.totalCost,
      });
    }
    changes.push({ label, action: a.kind, detail, ok: true });
  }

  const after = dryRun ? before : await getCart(cookies);

  return ok({
    dryRun,
    changes,
    skipped,
    failed,
    cartItemsBefore: before.ok ? before.data.items : null,
    cartItemsAfter: after.ok ? after.data.items : null,
    totalCost: plan.totalCost,
  });
}

/** Willys has no update endpoint; a replace is a removal plus an add. */
async function runAction(
  cookies: string,
  a: Extract<PlanAction, { kind: "add" | "change_quantity" | "replace" }>,
): Promise<Result<unknown>> {
  switch (a.kind) {
    case "add":
      return addToCart(cookies, a.code, a.packages);

    case "change_quantity":
      // addProducts sets the quantity rather than incrementing it.
      return addToCart(cookies, a.code, a.to);

    case "replace": {
      const removed = await removeFromCart(cookies, a.fromCode);
      if (!removed.ok) return removed;
      return addToCart(cookies, a.toCode, a.packages);
    }
  }
}

/** Drop the remembered choice for a line, so the next plan re-picks freely. */
export function resetChoice(planId: string, key: string): void {
  forgetChoice(planId, key);
}
