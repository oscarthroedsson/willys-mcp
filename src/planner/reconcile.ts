import { err, ok, type Result } from "../core/result.js";
import {
  planCoverage,
  type Candidate,
  type CoverageResult,
  type CoverageStrategy,
  type SurplusDecision,
} from "../domain/coverage.js";
import type { Product } from "../domain/product.js";
import { parseVolume } from "../domain/volume.js";
import { pieceWeight } from "../domain/piece-weights.js";
import { matchesQuery, attributeConflict } from "../domain/name-match.js";
import { verifySession } from "../auth/login.js";
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
  /** Set when a count requirement was estimated into a weight to match loose goods. */
  converted?: { fromCount: number; grams: number; gramsEach: number };
  /**
   * True when the chosen product's name does not plausibly answer the query —
   * "potatis" resolving to "Lök Gul", "falukorv" to a chicken sausage. The
   * cheapest match can be the wrong thing entirely; this is the signal to ask
   * before buying it. Never blocks — it flags.
   */
  uncertainMatch: boolean;
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
  /**
   * Ingredient keys where the caller has confirmed an uncertain match is
   * actually right. Those lines stop being held back by applyPlan.
   */
  acceptMatch?: string[] | undefined;
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
    mustNotContain: need.mustNotContain,
    limit,
  };

  const toCandidates = (products: Product[]): Candidate[] =>
    products.map((p) => ({
      code: p.code,
      name: p.name,
      // packagePrice, not price: for loose goods `price` is kr/kg, not what
      // one package costs. Coverage maths must see the real package cost.
      price: p.packagePrice,
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
  // a genuinely empty shelf. Retry without it to learn the real facet list.
  const retry = await findCheapest(cookies, { ...base, category: undefined });
  if (!retry.ok) return retry;

  const realFacets = retry.data.availableCategories.map((c) => c.name);

  // The facet match is exact server-side, so a stray space or a different case
  // in the round-tripped category yields zero hits and looks like a false
  // negative — the report saw "Potatis & rotsaker" rejected while listed as
  // valid. Resolve the requested category to the canonical facet and try once
  // more before giving up.
  const canonical = realFacets.find(
    (f) => normaliseFacet(f) === normaliseFacet(need.category!),
  );
  if (canonical && canonical !== need.category) {
    const canon = await findCheapest(cookies, { ...base, category: canonical });
    if (canon.ok && canon.data.products.length > 0) {
      return ok({
        candidates: toCandidates(canon.data.products),
        availableCategories: canon.data.availableCategories.map((c) => c.name),
      });
    }
  }

  return ok({
    candidates: toCandidates(retry.data.products),
    droppedCategory: { requested: need.category, available: realFacets },
    availableCategories: realFacets,
  });
}

/** Case-, whitespace- and unicode-insensitive facet key for matching. */
function normaliseFacet(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function decideAction(
  chosen: CoverageStrategy | null,
  previous: RecordedChoice | null,
  availableCategories: string[],
  need: AggregatedNeed,
  needsWeight: boolean,
): PlanAction {
  if (!chosen) {
    // A count need with no known piece weight: the fix is a weight, not a
    // different search term. Say exactly that.
    if (needsWeight) {
      return {
        kind: "blocked",
        reason:
          `"${need.label}" anges i styck men säljs i lösvikt. Ange mängden i ` +
          `vikt (t.ex. gram) — jag känner ingen styckvikt för "${need.query}".`,
      };
    }
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

interface Covered {
  coverage: CoverageResult;
  /** Set when a count need was estimated into a weight to match loose goods. */
  converted?: { fromCount: number; grams: number; gramsEach: number };
  /** True when nothing matched because the need is in pieces and no weight is known. */
  needsWeight: boolean;
}

/**
 * Cover a need, converting pieces to weight when that is the only way to match.
 *
 * Recipes count in pieces but Willys sells loose produce by weight, so a "2 st"
 * requirement finds only measure-mismatched candidates. When a piece weight is
 * known, the requirement is re-expressed in grams and matched again; when it is
 * not, the caller is told a weight is needed rather than just "blocked".
 */
function coverNeed(need: AggregatedNeed, candidates: Candidate[]): Covered {
  const coverage = planCoverage(
    { amount: need.amount, measure: need.measure },
    candidates,
  );

  if (coverage.best || need.measure !== "count") {
    return { coverage, needsWeight: false };
  }

  // Nothing matched a count need. If the candidates are weight-sold and we know
  // a per-piece weight, retry in grams.
  const massRejected = coverage.rejected.some(
    (r) => r.reason === "measure_mismatch",
  );
  if (!massRejected) return { coverage, needsWeight: false };

  const gramsEach = pieceWeight(need.query);
  if (gramsEach === null) return { coverage, needsWeight: true };

  const grams = need.amount * gramsEach;
  const massCoverage = planCoverage({ amount: grams, measure: "mass" }, candidates);
  if (!massCoverage.best) return { coverage: massCoverage, needsWeight: false };

  return {
    coverage: massCoverage,
    converted: { fromCount: need.amount, grams, gramsEach },
    needsWeight: false,
  };
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
  // "*" means "all" — the keys are search terms, and changing one to fix a
  // match silently invalidated a prior per-key approval. The wildcard survives
  // that. A helper keeps the intent readable.
  const accSurplus = opts.acceptSurplus ?? [];
  const accTight = opts.preferTight ?? [];
  const acceptsSurplus = (key: string) =>
    accSurplus.includes("*") || accSurplus.includes(key);
  const prefersTight = (key: string) =>
    accTight.includes("*") || accTight.includes(key);
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
        uncertainMatch: false,
      });
      unresolved++;
      continue;
    }

    const covered = coverNeed(need, cands.data.candidates);
    const coverage = covered.coverage;

    // Resolve the surplus trade-off if the caller has already answered it.
    let chosen = coverage.best;
    let decision = coverage.decision;
    if (decision) {
      if (prefersTight(need.key)) {
        chosen = decision.tightest;
        decision = null;
      } else if (acceptsSurplus(need.key)) {
        chosen = decision.cheapest;
        decision = null;
      } else {
        pendingDecisions++;
      }
    }

    if (chosen) totalCost += chosen.totalCost;
    else unresolved++;

    // Does the chosen product actually answer the query? A cheapest-first
    // match can be the wrong noun (potatis -> lök) or the wrong attribute
    // (grön -> gul paprika). Both flag, independent of any surplus setting.
    const uncertainMatch =
      chosen !== null &&
      (!matchesQuery(chosen.name, need.query) ||
        attributeConflict(chosen.name, need.query));

    lines.push({
      need,
      chosen,
      coverage,
      previous,
      action: decideAction(
        chosen,
        previous,
        cands.data.availableCategories,
        need,
        covered.needsWeight,
      ),
      decision,
      uncertainMatch,
      ...(cands.data.droppedCategory
        ? { droppedCategory: cands.data.droppedCategory }
        : {}),
      ...(covered.converted ? { converted: covered.converted } : {}),
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
  acceptMatch: string[] = [],
): Promise<Result<ApplyResult>> {
  // Preflight: confirm the session is live before writing anything. A session
  // can pass at dry-run and be dead 30 seconds later at apply; without this the
  // old code fired 30 writes into 30 identical 401s and could half-fill a cart.
  if (!dryRun) {
    const alive = await verifySession(cookies);
    if (!alive.ok) {
      return err(
        "AUTH_EXPIRED",
        "Sessionen är inte längre giltig. Kör willys_login (force=true) och kör " +
          "om — inget skrevs till kundvagnen.",
      );
    }
  }

  const before = await getCart(cookies);
  // No "*" here on purpose: a wrong-product match must be confirmed per line.
  // Blanket-accepting uncertain matches is exactly what this gate prevents.
  const accepted = new Set(acceptMatch);
  const acceptsMatch = (key: string) => accepted.has(key);
  const changes: AppliedChange[] = [];
  let skipped = 0;
  let failed = 0;
  let aborted = false;

  for (const line of plan.lines) {
    const label = line.need.label;

    // Session died mid-batch: stop rather than pile up more 401s. What was
    // already written stays; re-running after re-login only sends the diff.
    if (aborted) {
      skipped++;
      changes.push({
        label,
        action: "none",
        detail: "avbruten — sessionen dog under körningen",
        ok: false,
      });
      continue;
    }

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

    // An uncertain match is held back until confirmed — potatis→lök must not
    // slip into the cart just because the price and quantity looked fine.
    if (line.uncertainMatch && !acceptsMatch(line.need.key)) {
      skipped++;
      changes.push({
        label,
        action: "none",
        detail: `osäker matchning (${line.chosen?.name ?? "?"}) — bekräfta via acceptMatch: ["${line.need.key}"]`,
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
      // A 401 mid-batch means the session died — abort the rest instead of
      // firing the same failure at every remaining line.
      if (applied.kind === "AUTH_EXPIRED") aborted = true;
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
