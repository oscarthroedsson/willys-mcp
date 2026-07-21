import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./config.js";
import { err, ok, type Result } from "./core/result.js";

/**
 * On-demand documentation for the consuming model.
 *
 * The initialize instructions stay short — spent on every connection — and the
 * verbose material lives in docs/help/*.md, read only when a topic is actually
 * needed.
 *
 * The read is guarded deterministically: a requested path is resolved and must
 * land inside docs/, so no argument can reach .env, the session database, or
 * anything else on the machine. That guarantee is not a policy the model has to
 * honour — it is enforced here, which is exactly why the tool can be described
 * as safe to call freely.
 */

const DOCS_ROOT = path.join(PROJECT_ROOT, "docs");

/** The docs worth pointing the model at, with a one-line purpose each. */
export const DOCS: Record<string, string> = {
  "help/setup.md": "uppsättningen steg för steg",
  "help/security.md": "varför inloggning är säker att anropa",
  "help/search.md": "sök- och prisverktygens parametrar och fällor",
  "help/planning.md": "receptplaneringsflödet i detalj",
  "help/errors.md": "vad varje felklass betyder och vad du gör",
};

/**
 * Read one bundled doc.
 *
 * Returns INPUT when the path escapes docs/ or is not markdown, NOT_FOUND when
 * the file is absent. The path never touches anything outside docs/.
 */
export function readDoc(rel: string): Result<string> {
  const resolved = path.resolve(DOCS_ROOT, rel);

  // Traversal guard: the resolved path must stay within docs/. This is what
  // makes the tool safe regardless of what the model passes.
  const inside =
    resolved === DOCS_ROOT || resolved.startsWith(DOCS_ROOT + path.sep);
  if (!inside) {
    return err("INPUT", `Sökvägen ligger utanför docs/ och kan inte läsas: ${rel}`);
  }
  if (!resolved.endsWith(".md")) {
    return err("INPUT", "Bara .md-dokument kan läsas.");
  }

  try {
    if (!statSync(resolved).isFile()) {
      return err("NOT_FOUND", `Inte en fil: ${rel}`);
    }
    return ok(readFileSync(resolved, "utf8"));
  } catch {
    const list = Object.keys(DOCS).join(", ");
    return err("NOT_FOUND", `Dokumentet finns inte: ${rel}. Tillgängliga: ${list}`);
  }
}
