import { readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./config.js";

/**
 * On-demand help.
 *
 * The initialize instructions stay short — spent on every connection — and the
 * verbose material lives in docs/help/*.md, fetched only when a topic is
 * actually needed. One markdown file per topic keeps the runtime help and the
 * repo's own docs as a single source rather than a copy that drifts.
 */

export const HELP_TOPICS = [
  "security",
  "setup",
  "search",
  "planning",
  "errors",
] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export function isHelpTopic(v: string): v is HelpTopic {
  return (HELP_TOPICS as readonly string[]).includes(v);
}

/** Read one help doc. Path is fixed by the topic enum, never user input. */
export function readHelp(topic: HelpTopic): string {
  const file = path.join(PROJECT_ROOT, "docs", "help", `${topic}.md`);
  try {
    return readFileSync(file, "utf8");
  } catch {
    return `Hjälpdokumentet för "${topic}" kunde inte läsas (${file}).`;
  }
}
