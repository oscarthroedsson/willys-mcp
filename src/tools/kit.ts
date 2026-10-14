import type { z } from "zod";
import { explain, type Result } from "../core/result.js";
import type { ToolName } from "../constants/index.js";
import type { Capability, ChainAdapter, ChainId } from "../chains/types.js";

/**
 * The tool contract.
 *
 * Each tool is one self-contained unit — name, description, schema, and its own
 * handler including response shaping. Previously a tool lived in three files
 * (name in constants, schema in a registry, handler in a 600-line switch); this
 * co-locates all of it, so adding a tool means adding one object, not editing a
 * god-file.
 */

export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export const text = (s: string): ToolResponse => ({
  content: [{ type: "text", text: s }],
});

export const failure = (s: string): ToolResponse => ({
  content: [{ type: "text", text: s }],
  isError: true,
});

/** Turn a Result into a tool response, never swallowing the error kind. */
export function respond<T>(
  r: Result<T>,
  render: (v: T) => string,
): ToolResponse {
  if (r.ok) return text(render(r.data));
  return failure(`${explain(r.kind)} (${r.kind}) — ${r.message}`);
}

/** A failure in the same shape respond() uses, for checks made before any call. */
export function refuse(kind: Parameters<typeof explain>[0], message: string): ToolResponse {
  return failure(`${explain(kind)} (${kind}) — ${message}`);
}

/**
 * What a handler is given besides its parsed arguments.
 *
 * The dispatcher resolves all of this once, so no handler re-implements it:
 * - `cookies`: the session for `sessionId`, "" when the call is anonymous.
 * - `chain` / `adapter`: from the `chain` argument, already checked to have the
 *   capability the tool declares. Null for tools without a chain.
 * - `storeId`: the store argument, or the user's default for that chain, already
 *   checked against the chain's registry when the tool asks for it.
 */
export interface Ctx {
  cookies: string;
  chain: ChainId | null;
  adapter: ChainAdapter | null;
  storeId?: string | undefined;
}

/**
 * - "required": a valid `sessionId` must be passed (cart, orders).
 * - "optional": anonymous works; a `sessionId` makes it the user's own view
 *   (their store's prices).
 * - "none": no session involved.
 */
export type AuthMode = "required" | "optional" | "none";

export interface Tool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: ToolName;
  description: string;
  schema: S;
  auth: AuthMode;
  /** What the chain must support. Checked before the handler runs. */
  capability?: Capability;
  /**
   * Check `storeId` against the chain's store registry before running, so a
   * Willys id sent to Hemköp is "no such store" instead of zero hits.
   */
  validateStore?: boolean;
  handle: (args: z.infer<S>, ctx: Ctx) => ToolResponse | Promise<ToolResponse>;
}

export type AnyTool = Tool<z.ZodTypeAny>;

/** Define a tool with per-tool argument inference in the handler. */
export function defineTool<S extends z.ZodTypeAny>(t: Tool<S>): AnyTool {
  return t as unknown as AnyTool;
}
