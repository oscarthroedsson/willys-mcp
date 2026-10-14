import { getSession } from "../auth/session.js";
import { DEFAULT_STORE_ID } from "../config.js";
import { chainsWith, getAdapter } from "../chains/registry.js";
import { storeKnown } from "../chains/stores.js";
import type { ChainAdapter, ChainId } from "../chains/types.js";
import { log } from "../core/logger.js";
import { RETIRED_TOOLS, TOOL, type ToolName } from "../constants/index.js";
import { jsonSchema } from "./json-schema.js";
import { failure, refuse, type AnyTool, type Ctx, type ToolResponse } from "./kit.js";
import { cartTools } from "./cart-tools.js";
import { ordersTools } from "./orders-tools.js";
import { plannerTools } from "./planner-tools.js";
import { searchTools } from "./search-tools.js";
import { sessionTools } from "./session.js";
import { setupTools } from "./setup-tools.js";
import { storesTools } from "./stores-tools.js";

/**
 * Every tool, gathered from the per-domain modules.
 *
 * A tool is one self-contained object (name + schema + description + handler).
 * Adding one means adding it to its group file — not editing a name constant, a
 * schema registry, and a dispatch switch in three places.
 */
export const TOOLS: AnyTool[] = [
  ...sessionTools,
  ...setupTools,
  ...searchTools,
  ...cartTools,
  ...ordersTools,
  ...storesTools,
  ...plannerTools,
];

const BY_NAME = new Map<ToolName, AnyTool>(TOOLS.map((t) => [t.name, t]));

// Startup drift guard, replacing the old switch's `never` exhaustiveness:
// every declared tool name must have a registered handler, or the server
// refuses to start rather than failing silently on a call later.
for (const name of Object.values(TOOL)) {
  if (!BY_NAME.has(name)) {
    throw new Error(`Verktyget ${name} är deklarerat men saknar handler`);
  }
}

/** The manifest advertised to the client, derived from the same Zod source. */
export const toolManifest = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: jsonSchema(t.schema),
}));

/**
 * The single path every tool call takes: look up, validate, resolve chain,
 * capability, session and store, run.
 *
 * Centralising this here removes the per-tool boilerplate that used to repeat in
 * every switch case — the unknown-tool branch, the Zod validation, the
 * session→cookies resolution, the "this chain cannot do that" answer, and the
 * last-resort try/catch that keeps one bad throw from killing the transport.
 */
export async function dispatch(
  name: string,
  rawArgs: unknown,
): Promise<ToolResponse> {
  const tool = BY_NAME.get(name as ToolName);
  if (!tool) {
    const retired = RETIRED_TOOLS[name];
    if (retired) {
      const instead = retired.replacement
        ? `Använd ${retired.replacement} i stället.`
        : "Det finns ingen direkt ersättning.";
      return failure(
        `Verktyget ${name} togs bort i version ${retired.since}. ${instead} ` +
          `${retired.note} (INPUT) — se ${TOOL.releaseNotes} med since före ${retired.since}.`,
      );
    }
    return failure(
      `Okänt verktyg: ${name}. Minns du det från en äldre version, kör ${TOOL.releaseNotes}. (INPUT)`,
    );
  }

  // Enforcement, not documentation. The SDK does not validate for us.
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(rot)"}: ${i.message}`)
      .join("; ");
    return failure(`Ogiltiga argument (INPUT) — ${issues}`);
  }

  const args = parsed.data as { chain?: ChainId; sessionId?: string; storeId?: string };
  const ctx: Ctx = { cookies: "", chain: null, adapter: null };

  // Chain and capability: refuse up front, naming the chains that can.
  let adapter: ChainAdapter | null = null;
  if (args.chain) {
    adapter = getAdapter(args.chain);
    if (tool.capability && !adapter.capabilities.has(tool.capability)) {
      const able = chainsWith(tool.capability).map((c) => c.id).join(", ") || "ingen";
      return refuse(
        "INPUT",
        `${adapter.displayName} stöds inte för ${tool.name} här. Kedjor som stöder det: ${able}.`,
      );
    }
    ctx.chain = args.chain;
    ctx.adapter = adapter;
  }

  // Session: required, optional, or not involved. A session belongs to one chain.
  if (tool.auth !== "none" && (tool.auth === "required" || args.sessionId)) {
    const session = getSession(args.sessionId ?? "");
    if (!session) {
      return failure("Sessionen har gått ut eller finns inte. Kör login igen. (AUTH_EXPIRED)");
    }
    if (args.chain && session.chain !== args.chain) {
      return refuse(
        "INPUT",
        `sessionId gäller ${session.chain}, inte ${args.chain}. Logga in för rätt kedja ` +
          "eller utelämna sessionId.",
      );
    }
    ctx.cookies = session.cookies;
  }

  // Store: the argument, else the user's configured default for Willys.
  if (adapter) {
    ctx.storeId = args.storeId ?? (adapter.id === "willys" ? (DEFAULT_STORE_ID() ?? undefined) : undefined);
    if (tool.validateStore && args.storeId) {
      const known = await storeKnown(adapter, args.storeId);
      if (known.ok && !known.data) {
        return refuse(
          "NOT_FOUND",
          `Butiken ${args.storeId} finns inte hos ${adapter.displayName}. ` +
            `Slå upp ett id med find_stores({ chain: "${adapter.id}" }).`,
        );
      }
    }
  }

  try {
    return await tool.handle(parsed.data, ctx);
  } catch (e) {
    // Last-resort boundary: an unexpected throw must not kill the transport.
    log.error("ohanterat fel i verktyg", { name, error: String(e) });
    return failure(
      `Internt fel i ${name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
