import { err, ok, type Result } from "../../core/result.js";

/**
 * Minimal surface of a Zod schema, so the upstream modules do not each need to
 * import zod just to describe what they parse against.
 */
export interface SafeParser<T> {
  safeParse: (value: unknown) => {
    success: boolean;
    data?: T;
    error?: unknown;
  };
}

/**
 * Parse with a permissive schema, converting shape failures into SHAPE errors.
 *
 * A shape failure is not an outage: it means Willys changed a response and our
 * schema is behind. Keeping it a distinct kind lets the caller say so instead of
 * reporting a generic upstream fault.
 */
export function parse<T>(schema: SafeParser<T>, value: unknown): Result<T> {
  const r = schema.safeParse(value);
  if (!r.success || r.data === undefined) {
    return err("SHAPE", `Oväntat svarsformat: ${String(r.error).slice(0, 200)}`);
  }
  return ok(r.data);
}
