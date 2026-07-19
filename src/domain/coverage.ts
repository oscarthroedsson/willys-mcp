import {
  packagesNeeded,
  type ParsedVolume,
  type Requirement,
} from "./volume.js";

/**
 * How to cover a requirement with whole packages, and what each way costs.
 *
 * `findCheapest` answers "which product is cheapest per kilo". That is the wrong
 * question once a concrete amount is known. Covering 13 eggs with the lowest
 * kr/st might mean three 6-packs; a single 24-pack can be cheaper in real money
 * while being worse per unit — you cannot buy 13 eggs, only packages of them.
 *
 * Everything here is pure. No network, no session, no upstream shape.
 */

export interface Candidate {
  code: string;
  name: string;
  /** Price for ONE package, in kronor. Null means unpriceable — skipped. */
  price: number | null;
  /** Parsed package size. Null means unparseable — skipped. */
  pack: ParsedVolume | null;
  brand?: string | null;
}

export interface CoverageStrategy {
  code: string;
  name: string;
  /** Package size as Willys stated it, e.g. "6p" or "ca: 850g". */
  packSize: string;
  packages: number;
  /** Total amount acquired, in the requirement's normalised unit. */
  totalAmount: number;
  surplus: number;
  /** Surplus as a fraction of the requirement. 0.85 = 85% more than needed. */
  surplusRatio: number;
  /** What this strategy actually costs: price × packages. */
  totalCost: number;
  /** Cost per normalised unit acquired, for comparison across pack sizes. */
  costPerUnit: number;
  /** True when the pack is sold by weight ("ca:") and totals are estimates. */
  approximate: boolean;
}

export type RejectionReason =
  | "no_price"
  | "unparseable_pack"
  | "measure_mismatch";

export interface RejectedCandidate {
  code: string;
  name: string;
  reason: RejectionReason;
}

/**
 * A choice the server refuses to make silently.
 *
 * Raised when the cheapest way to cover the requirement overshoots it
 * substantially and a tighter-fitting option exists. Buying 11 spare eggs to
 * save 8 kr is a reasonable trade, but it is the household's trade to make —
 * the server presents both and lets the caller decide.
 */
export interface SurplusDecision {
  kind: "surplus";
  question: string;
  cheapest: CoverageStrategy;
  tightest: CoverageStrategy;
  /** Positive: choosing `tightest` over `cheapest` costs this many kronor more. */
  extraCost: number;
  /** Positive: choosing `cheapest` leaves this much more surplus. */
  extraSurplus: number;
}

export interface CoverageResult {
  requirement: Requirement;
  /** Cheapest total cost. Null when nothing could be evaluated. */
  best: CoverageStrategy | null;
  /** Other viable strategies, cheapest first, excluding `best`. */
  alternatives: CoverageStrategy[];
  /** Set when `best` overshoots enough that a human should weigh in. */
  decision: SurplusDecision | null;
  rejected: RejectedCandidate[];
}

/**
 * Surplus above this fraction of the requirement is worth asking about.
 *
 * 0.5 means "you would be buying half again as much as the recipes need".
 * Below that, rounding up to whole packages is unavoidable and not interesting.
 */
const SURPLUS_QUESTION_THRESHOLD = 0.5;

/**
 * A tighter option must actually be meaningfully tighter to be worth offering.
 * Without this, a 2% difference in surplus produces a question nobody wants.
 */
const MIN_SURPLUS_IMPROVEMENT = 0.25;

function evaluate(
  need: Requirement,
  candidate: Candidate,
): CoverageStrategy | RejectedCandidate {
  const { code, name, price, pack } = candidate;

  if (price === null) return { code, name, reason: "no_price" };
  if (!pack) return { code, name, reason: "unparseable_pack" };

  const math = packagesNeeded(need, pack);
  // Null means the measures disagree — millilitres asked of a product sold by
  // weight. Converting would need density, which this API does not expose.
  if (!math) return { code, name, reason: "measure_mismatch" };

  const totalCost = Number((price * math.packages).toFixed(2));

  return {
    code,
    name,
    packSize: pack.raw,
    packages: math.packages,
    totalAmount: math.totalAmount,
    surplus: math.surplus,
    surplusRatio: need.amount > 0 ? math.surplus / need.amount : 0,
    totalCost,
    costPerUnit:
      math.totalAmount > 0
        ? Number((totalCost / math.totalAmount).toFixed(6))
        : 0,
    approximate: math.approximate,
  };
}

function isStrategy(
  v: CoverageStrategy | RejectedCandidate,
): v is CoverageStrategy {
  return "totalCost" in v;
}

/**
 * Rank every way of covering `need`, cheapest total cost first.
 *
 * Ties on cost are broken by lower surplus: given two equally priced routes,
 * the one that wastes less food wins without needing to ask.
 */
export function planCoverage(
  need: Requirement,
  candidates: Candidate[],
): CoverageResult {
  const strategies: CoverageStrategy[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const c of candidates) {
    const outcome = evaluate(need, c);
    if (isStrategy(outcome)) strategies.push(outcome);
    else rejected.push(outcome);
  }

  strategies.sort(
    (a, b) => a.totalCost - b.totalCost || a.surplus - b.surplus,
  );

  const best = strategies[0] ?? null;
  const alternatives = strategies.slice(1);

  return {
    requirement: need,
    best,
    alternatives,
    decision: best ? surplusDecision(best, alternatives) : null,
    rejected,
  };
}

/**
 * Should the caller be asked to weigh cost against surplus?
 *
 * Only when all three hold: the cheapest route overshoots materially, some
 * other route fits materially better, and that better fit genuinely costs more.
 * If the tighter option is also cheaper it would already be `best`, so there is
 * nothing to decide.
 */
function surplusDecision(
  best: CoverageStrategy,
  alternatives: CoverageStrategy[],
): SurplusDecision | null {
  if (best.surplusRatio <= SURPLUS_QUESTION_THRESHOLD) return null;

  let tightest: CoverageStrategy | null = null;
  for (const alt of alternatives) {
    if (alt.surplusRatio > best.surplusRatio - MIN_SURPLUS_IMPROVEMENT) continue;
    if (!tightest || alt.totalCost < tightest.totalCost) tightest = alt;
  }
  if (!tightest) return null;

  const extraCost = Number((tightest.totalCost - best.totalCost).toFixed(2));
  if (extraCost <= 0) return null;

  const unit = unitLabel(best);
  const extraSurplus = Number((best.surplus - tightest.surplus).toFixed(2));

  return {
    kind: "surplus",
    question:
      `${best.name} (${best.packages}× ${best.packSize}) är ${extraCost} kr billigare ` +
      `men ger ${formatAmount(best.surplus, unit)} över behovet. ` +
      `${tightest.name} (${tightest.packages}× ${tightest.packSize}) ger bara ` +
      `${formatAmount(tightest.surplus, unit)} över. Vill du ha det billigare med överskott?`,
    cheapest: best,
    tightest,
    extraCost,
    extraSurplus,
  };
}

/** Normalised units are grams, millilitres or items; label them readably. */
function unitLabel(s: CoverageStrategy): "g" | "ml" | "st" {
  const raw = s.packSize.toLowerCase();
  if (/\d\s*(kg|g)\b/.test(raw)) return "g";
  if (/\d\s*(l|dl|cl|ml)\b/.test(raw)) return "ml";
  return "st";
}

function formatAmount(amount: number, unit: "g" | "ml" | "st"): string {
  if (unit === "st") return `${Math.round(amount)} st`;
  if (amount >= 1000) {
    const big = unit === "g" ? "kg" : "l";
    return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 2)} ${big}`;
  }
  return `${Math.round(amount)} ${unit}`;
}
