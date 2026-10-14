import { readFileSync } from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "./config.js";
import { err, ok, type Result } from "./core/result.js";

/**
 * Release notes for the consuming model.
 *
 * A model connecting to this server carries whatever it learned about the tool
 * surface from earlier sessions, training data or a stale prompt. After a
 * breaking release that memory is wrong, and the model will confidently call a
 * tool that no longer exists. The fix is to make "what changed since the version
 * I knew" a cheap, explicit question: the version rides in the initialize
 * response, and release_notes answers with only the entries newer than
 * the version the model names.
 *
 * docs/CHANGELOG.md is the single source. It follows Keep a Changelog so humans
 * and GitHub Releases read the same file the model does — there is no second
 * copy to drift.
 */

const CHANGELOG = path.join(PACKAGE_ROOT, "docs", "CHANGELOG.md");

/** The version in package.json — the one npm installed, never a hardcoded copy. */
export const PACKAGE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export interface Release {
  /** "unreleased" for the [Unreleased] section. */
  version: string;
  date: string | null;
  /** False for [Unreleased]: in the code you run from a checkout, not yet in a release. */
  released: boolean;
  /** True when the entry has a "### Brytande" section — the model must read it. */
  breaking: boolean;
  body: string;
}

const HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/;

/**
 * Parse the changelog, newest first. [Unreleased] is included only when it has
 * content and `includeUnreleased` is set: a published package should have an
 * empty one, but a server run from a checkout carries changes no release
 * describes yet — and a model talking to it needs to know about them.
 */
export function parseChangelog(src: string, includeUnreleased = false): Release[] {
  const out: Release[] = [];
  let current: Release | null = null;
  const lines: string[] = [];

  const flush = () => {
    if (!current) return;
    current.body = lines.join("\n").trim();
    current.breaking = /^### Brytande/m.test(current.body);
    out.push(current);
  };

  for (const line of src.split("\n")) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      lines.length = 0;
      const version = m[1] ?? "";
      const unreleased = version.toLowerCase() === "unreleased";
      current =
        unreleased && !includeUnreleased
          ? null
          : unreleased
            ? { version: "unreleased", date: null, released: false, breaking: false, body: "" }
            : { version, date: m[2] ?? null, released: true, breaking: false, body: "" };
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return out.filter((r) => r.released || r.body.length > 0);
}

/** Numeric semver compare on major.minor.patch; pre-release tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
  const pb = b.split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Entries newer than `since`, newest first. Without `since`, the latest three —
 * enough to orient a model that does not know which version it last saw.
 */
export function releasesSince(since?: string): Result<Release[]> {
  let src: string;
  try {
    src = readFileSync(CHANGELOG, "utf8");
  } catch {
    return err("NOT_FOUND", "docs/CHANGELOG.md saknas i paketet.");
  }
  const all = parseChangelog(src, true);
  if (!since) return ok(all.slice(0, 3));
  return ok(all.filter((r) => !r.released || compareVersions(r.version, since) > 0));
}

/**
 * The block appended to the initialize instructions. Built at startup so the
 * version can never drift from package.json, and kept to a few lines because it
 * is spent on every connection.
 */
export function versionInstructions(): string {
  const recent = releasesSince();
  const latestBreaking = recent.ok ? (recent.data.find((x) => x.released && x.breaking) ?? null) : null;
  const unreleasedBreaking = recent.ok && recent.data.some((x) => !x.released && x.breaking);

  return `

## Version ${PACKAGE_VERSION} — kontrollera ändringar innan du litar på ditt minne

Du kör version ${PACKAGE_VERSION} av servern. Känner du till verktygsnamn eller
parametrar från en tidigare session eller version: anropa
release_notes med since = den versionen du kände till, innan du
anropar något. Saknas ett verktyg du minns, eller svarar ett anrop att verktyget
är borttaget, står ersättningen där.${
    latestBreaking
      ? `\nSenaste brytande version: ${latestBreaking.version}. Läs dess migrering.`
      : ""
  }${
    unreleasedBreaking
      ? "\nDen här servern kör kod med osläppta brytande ändringar. Kör release_notes " +
        "(utan since) och läs avsnittet unreleased innan du anropar något."
      : ""
  }`;
}
