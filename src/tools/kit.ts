import type { z } from "zod";
import { explain, type Result } from "../core/result.js";
import type { ToolName } from "../constants/index.js";

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

/**
 * What a handler is given besides its parsed arguments.
 *
 * `cookies` is the resolved session for tools that declare needsAuth — the
 * dispatcher resolves it once from the sessionId argument, so no handler
 * re-implements the "session expired" branch. It is an empty string for tools
 * that need no session.
 */
export interface Ctx {
  cookies: string;
}

export interface Tool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: ToolName;
  description: string;
  schema: S;
  /** True when the tool talks to Willys and needs resolved session cookies. */
  needsAuth: boolean;
  handle: (args: z.infer<S>, ctx: Ctx) => ToolResponse | Promise<ToolResponse>;
}

export type AnyTool = Tool<z.ZodTypeAny>;

/** Define a tool with per-tool argument inference in the handler. */
export function defineTool<S extends z.ZodTypeAny>(t: Tool<S>): AnyTool {
  return t as unknown as AnyTool;
}
