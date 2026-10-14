import Database from "better-sqlite3";
import { DB_PATH } from "../config.js";
import { log } from "../core/logger.js";
import { parseRequirement, type Measure } from "../domain/volume.js";

/**
 * The requirement ledger.
 *
 * The cart is a projection of what the accepted recipes need, not a pile of
 * things that were added once. Storing each recipe's contribution separately
 * rather than a running total buys two properties that matter:
 *
 *   - provenance comes free ("13 ägg" is A:6 + B:4 + C:3), so a change to one
 *     recipe can be explained rather than just appearing;
 *   - removing a recipe is a delete, not an attempt to subtract amounts that
 *     were already rounded up into packages.
 *
 * Aggregation happens on read. Nothing here talks to Willys.
 */

/** One ingredient line as a recipe states it. */
export interface IngredientInput {
  /** Search term, and the key contributions aggregate on. Lowercased. */
  query: string;
  /** Human label for output. Defaults to `query`. */
  label?: string | undefined;
  /** Amount as written, e.g. "6 st", "400 g", "8 dl". */
  amount: string;
  category?: string | undefined;
  requireSwedishMeat?: boolean | undefined;
  mustContain?: string[] | undefined;
  mustNotContain?: string[] | undefined;
}

export interface NeedSource {
  recipe: string;
  amount: number;
  /** The amount exactly as that recipe wrote it. */
  raw: string;
}

export interface AggregatedNeed {
  key: string;
  label: string;
  query: string;
  category: string | null;
  requireSwedishMeat: boolean;
  mustContain: string[];
  mustNotContain: string[];
  /** Summed, in the normalised unit for `measure`. */
  amount: number;
  measure: Measure;
  sources: NeedSource[];
}

/**
 * Two recipes wanting the same ingredient in incompatible units.
 *
 * "2 st tomat" and "400 g tomat" cannot be summed without knowing what a tomato
 * weighs. Surfacing the clash beats inventing a conversion and shopping wrong.
 */
export interface NeedConflict {
  key: string;
  label: string;
  measures: Array<{ measure: Measure; amount: number; recipes: string[] }>;
}

/** What was last put in the cart for one ingredient. */
export interface RecordedChoice {
  key: string;
  productCode: string;
  productName: string;
  packages: number;
  totalCost: number | null;
  decidedAt: number;
}

interface ItemRow {
  plan_id: string;
  recipe: string;
  key: string;
  label: string;
  query: string;
  category: string | null;
  amount: number;
  measure: string;
  raw_amount: string;
  require_swedish_meat: number;
  must_contain: string;
  must_not_contain: string;
}

interface ChoiceRow {
  key: string;
  product_code: string;
  product_name: string;
  packages: number;
  total_cost: number | null;
  decided_at: number;
}

let db: Database.Database | null = null;

function conn(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_items (
      plan_id              TEXT NOT NULL,
      recipe               TEXT NOT NULL,
      key                  TEXT NOT NULL,
      label                TEXT NOT NULL,
      query                TEXT NOT NULL,
      category             TEXT,
      amount               REAL NOT NULL,
      measure              TEXT NOT NULL,
      raw_amount           TEXT NOT NULL,
      require_swedish_meat INTEGER NOT NULL DEFAULT 0,
      must_contain         TEXT NOT NULL DEFAULT '[]',
      must_not_contain     TEXT NOT NULL DEFAULT '[]',
      created_at           INTEGER NOT NULL,
      PRIMARY KEY (plan_id, recipe, key)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id);

    CREATE TABLE IF NOT EXISTS plan_choices (
      plan_id      TEXT NOT NULL,
      key          TEXT NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      packages     INTEGER NOT NULL,
      total_cost   REAL,
      decided_at   INTEGER NOT NULL,
      PRIMARY KEY (plan_id, key)
    );
  `);

  // Migrate databases created before must_not_contain existed. ADD COLUMN is
  // cheap and the guard keeps it idempotent.
  const cols = db
    .prepare("PRAGMA table_info(plan_items)")
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "must_not_contain")) {
    db.exec(
      "ALTER TABLE plan_items ADD COLUMN must_not_contain TEXT NOT NULL DEFAULT '[]'",
    );
  }

  // A recorded choice is a product code, and codes mean nothing outside the
  // chain that issued them. Choices from before 2.0.0 were all Willys.
  const choiceCols = db
    .prepare("PRAGMA table_info(plan_choices)")
    .all() as Array<{ name: string }>;
  if (!choiceCols.some((c) => c.name === "chain")) {
    db.exec("ALTER TABLE plan_choices ADD COLUMN chain TEXT NOT NULL DEFAULT 'willys'");
  }

  return db;
}

/** Aggregation key: case- and whitespace-insensitive on the search term. */
export function ingredientKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface RejectedIngredient {
  query: string;
  amount: string;
  reason: string;
}

/**
 * Record what one recipe needs, replacing any earlier version of that recipe.
 *
 * Re-adding the same recipe name is therefore an update rather than a doubling
 * — which is what you want when a recipe is corrected mid-plan.
 */
export function addRecipe(
  planId: string,
  recipe: string,
  ingredients: IngredientInput[],
): { accepted: number; rejected: RejectedIngredient[] } {
  const c = conn();
  const rejected: RejectedIngredient[] = [];
  const now = Date.now();

  const rows: ItemRow[] = [];
  for (const ing of ingredients) {
    const parsed = parseRequirement(ing.amount);
    if (!parsed) {
      rejected.push({
        query: ing.query,
        amount: ing.amount,
        reason: `kunde inte tolka mängden "${ing.amount}" (väntar t.ex. "400 g", "6 st", "8 dl")`,
      });
      continue;
    }
    const key = ingredientKey(ing.query);
    rows.push({
      plan_id: planId,
      recipe,
      key,
      label: ing.label?.trim() || ing.query.trim(),
      query: ing.query.trim(),
      category: ing.category?.trim() || null,
      amount: parsed.amount,
      measure: parsed.measure,
      raw_amount: ing.amount,
      require_swedish_meat: ing.requireSwedishMeat ? 1 : 0,
      must_contain: JSON.stringify(ing.mustContain ?? []),
      must_not_contain: JSON.stringify(ing.mustNotContain ?? []),
    });
  }

  const replace = c.transaction((items: ItemRow[]) => {
    c.prepare("DELETE FROM plan_items WHERE plan_id = ? AND recipe = ?").run(
      planId,
      recipe,
    );
    const insert = c.prepare(`
      INSERT INTO plan_items
        (plan_id, recipe, key, label, query, category, amount, measure,
         raw_amount, require_swedish_meat, must_contain, must_not_contain, created_at)
      VALUES
        (@plan_id, @recipe, @key, @label, @query, @category, @amount, @measure,
         @raw_amount, @require_swedish_meat, @must_contain, @must_not_contain, ${now})
    `);
    for (const r of items) insert.run(r);
  });

  replace(rows);
  log.info(`plan ${planId}: recept "${recipe}" med ${rows.length} ingredienser`);
  return { accepted: rows.length, rejected };
}

export function removeRecipe(planId: string, recipe: string): number {
  const r = conn()
    .prepare("DELETE FROM plan_items WHERE plan_id = ? AND recipe = ?")
    .run(planId, recipe);
  return r.changes;
}

/**
 * Add or replace ONE ingredient in a recipe, leaving the rest untouched.
 *
 * Fixing a single mis-matched line used to mean resending the whole recipe —
 * ten other ingredients re-rolled through ranking, the main reason a five-recipe
 * plan took twelve add calls. This patches just the one row.
 */
export function setIngredient(
  planId: string,
  recipe: string,
  ing: IngredientInput,
): { ok: true; key: string } | { ok: false; reason: string } {
  const parsed = parseRequirement(ing.amount);
  if (!parsed) {
    return {
      ok: false,
      reason: `kunde inte tolka mängden "${ing.amount}" (väntar t.ex. "400 g", "6 st", "8 dl")`,
    };
  }
  const key = ingredientKey(ing.query);
  conn()
    .prepare(`
      INSERT INTO plan_items
        (plan_id, recipe, key, label, query, category, amount, measure,
         raw_amount, require_swedish_meat, must_contain, must_not_contain, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_id, recipe, key) DO UPDATE SET
        label = excluded.label, query = excluded.query, category = excluded.category,
        amount = excluded.amount, measure = excluded.measure,
        raw_amount = excluded.raw_amount,
        require_swedish_meat = excluded.require_swedish_meat,
        must_contain = excluded.must_contain,
        must_not_contain = excluded.must_not_contain
    `)
    .run(
      planId, recipe, key,
      ing.label?.trim() || ing.query.trim(),
      ing.query.trim(),
      ing.category?.trim() || null,
      parsed.amount, parsed.measure, ing.amount,
      ing.requireSwedishMeat ? 1 : 0,
      JSON.stringify(ing.mustContain ?? []),
      JSON.stringify(ing.mustNotContain ?? []),
      Date.now(),
    );
  return { ok: true, key };
}

/** Remove ONE ingredient from a recipe. Returns whether a row was deleted. */
export function removeIngredient(
  planId: string,
  recipe: string,
  query: string,
): boolean {
  const r = conn()
    .prepare(
      "DELETE FROM plan_items WHERE plan_id = ? AND recipe = ? AND key = ?",
    )
    .run(planId, recipe, ingredientKey(query));
  return r.changes > 0;
}

export function listRecipes(planId: string): string[] {
  const rows = conn()
    .prepare(
      "SELECT DISTINCT recipe FROM plan_items WHERE plan_id = ? ORDER BY recipe",
    )
    .all(planId) as Array<{ recipe: string }>;
  return rows.map((r) => r.recipe);
}

/**
 * Aggregate the ledger into one requirement per ingredient.
 *
 * Contributions in different measures are not summed — they come back as
 * conflicts for the caller to resolve, because there is no honest conversion
 * between "2 st" and "400 g" of the same thing.
 */
export function listNeeds(planId: string): {
  needs: AggregatedNeed[];
  conflicts: NeedConflict[];
} {
  const rows = conn()
    .prepare("SELECT * FROM plan_items WHERE plan_id = ? ORDER BY key, recipe")
    .all(planId) as ItemRow[];

  const byKey = new Map<string, ItemRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.key);
    if (list) list.push(row);
    else byKey.set(row.key, [row]);
  }

  const needs: AggregatedNeed[] = [];
  const conflicts: NeedConflict[] = [];

  for (const [key, group] of byKey) {
    const measures = new Set(group.map((g) => g.measure));

    if (measures.size > 1) {
      conflicts.push({
        key,
        label: group[0]!.label,
        measures: [...measures].map((m) => {
          const inMeasure = group.filter((g) => g.measure === m);
          return {
            measure: m as Measure,
            amount: inMeasure.reduce((s, g) => s + g.amount, 0),
            recipes: inMeasure.map((g) => g.recipe),
          };
        }),
      });
      continue;
    }

    const first = group[0]!;
    // Any recipe demanding Swedish meat makes the whole line demand it: the
    // strictest constraint wins, never the loosest.
    const requireSwedishMeat = group.some((g) => g.require_swedish_meat === 1);
    const mustContain = [
      ...new Set(
        group.flatMap((g) => JSON.parse(g.must_contain) as string[]),
      ),
    ];
    const mustNotContain = [
      ...new Set(
        group.flatMap((g) => JSON.parse(g.must_not_contain ?? "[]") as string[]),
      ),
    ];

    needs.push({
      key,
      label: first.label,
      query: first.query,
      category: group.find((g) => g.category)?.category ?? null,
      requireSwedishMeat,
      mustContain,
      mustNotContain,
      amount: group.reduce((s, g) => s + g.amount, 0),
      measure: first.measure as Measure,
      sources: group.map((g) => ({
        recipe: g.recipe,
        amount: g.amount,
        raw: g.raw_amount,
      })),
    });
  }

  needs.sort((a, b) => a.label.localeCompare(b.label, "sv"));
  return { needs, conflicts };
}

export function recordChoice(
  planId: string,
  choice: Omit<RecordedChoice, "decidedAt">,
  chain = "willys",
): void {
  conn()
    .prepare(`
      INSERT INTO plan_choices
        (plan_id, key, product_code, product_name, packages, total_cost, decided_at, chain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_id, key) DO UPDATE SET
        chain        = excluded.chain,
        product_code = excluded.product_code,
        product_name = excluded.product_name,
        packages     = excluded.packages,
        total_cost   = excluded.total_cost,
        decided_at   = excluded.decided_at
    `)
    .run(
      planId,
      choice.key,
      choice.productCode,
      choice.productName,
      choice.packages,
      choice.totalCost,
      Date.now(),
      chain,
    );
}

/** Choices recorded for this chain only — another chain's codes are meaningless here. */
export function listChoices(planId: string, chain = "willys"): Map<string, RecordedChoice> {
  const rows = conn()
    .prepare("SELECT * FROM plan_choices WHERE plan_id = ? AND chain = ?")
    .all(planId, chain) as ChoiceRow[];

  return new Map(
    rows.map((r) => [
      r.key,
      {
        key: r.key,
        productCode: r.product_code,
        productName: r.product_name,
        packages: r.packages,
        totalCost: r.total_cost,
        decidedAt: r.decided_at,
      },
    ]),
  );
}

export function forgetChoice(planId: string, key: string): void {
  conn()
    .prepare("DELETE FROM plan_choices WHERE plan_id = ? AND key = ?")
    .run(planId, key);
}

/** Wipe a plan entirely — both requirements and recorded cart choices. */
export function clearPlan(planId: string): { items: number; choices: number } {
  const c = conn();
  const items = c
    .prepare("DELETE FROM plan_items WHERE plan_id = ?")
    .run(planId).changes;
  const choices = c
    .prepare("DELETE FROM plan_choices WHERE plan_id = ?")
    .run(planId).changes;
  return { items, choices };
}
