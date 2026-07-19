/**
 * Token pruning.
 *
 * Measured against production: a raw product is 1459 characters across 46
 * fields. Thirty search hits cost ~44 KB of context. Pruned output lands
 * around 140 characters per product — a ~10x reduction with no loss of
 * decision-relevant information.
 */

/** Drop null/undefined, empty arrays, and false flags. */
export function prune(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * `origin` is exempt from pruning even when it is "OKAND": absence of origin
 * data is itself information the caller needs in order not to assume Swedish.
 */
export function pruneProduct<T extends { origin: string }>(
  p: T,
): Record<string, unknown> {
  return { ...prune(p), origin: p.origin };
}

/** Compact JSON for tool output — no indentation, which alone saves ~20%. */
export function compact(value: unknown): string {
  return JSON.stringify(value);
}
