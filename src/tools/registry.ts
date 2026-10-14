import { getCookies } from "../auth/session.js";
import { log } from "../core/logger.js";
import { RETIRED_TOOLS, TOOL, type ToolName } from "../constants/index.js";
import { jsonSchema } from "./json-schema.js";
import { failure, type AnyTool, type ToolResponse } from "./kit.js";
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
 * The single path every tool call takes: look up, validate, resolve auth, run.
 *
 * Centralising this here removes the per-tool boilerplate that used to repeat in
 * every switch case — the unknown-tool branch, the Zod validation, the
 * session→cookies resolution, and the last-resort try/catch that keeps one bad
 * throw from killing the transport.
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
          `${retired.note} (INPUT) — se willys_release_notes med since före ${retired.since}.`,
      );
    }
    return failure(
      `Okänt verktyg: ${name}. Minns du det från en äldre version, kör willys_release_notes. (INPUT)`,
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

  let cookies = "";
  if (tool.needsAuth) {
    const sid = (parsed.data as { sessionId?: string }).sessionId ?? "";
    const resolved = getCookies(sid);
    if (!resolved) {
      return failure(
        "Sessionen har gått ut eller finns inte. Kör willys_login igen. (AUTH_EXPIRED)",
      );
    }
    cookies = resolved;
  }

  try {
    return await tool.handle(parsed.data, { cookies });
  } catch (e) {
    // Last-resort boundary: an unexpected throw must not kill the transport.
    log.error("ohanterat fel i verktyg", { name, error: String(e) });
    return failure(
      `Internt fel i ${name}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
