import puppeteer from "puppeteer";
import { HEADLESS } from "../config.js";
import { PUPPETEER_ARGS, TIMING, USER_AGENT } from "../constants/index.js";
import { err, ok, type Result } from "../core/result.js";
import { log } from "../core/logger.js";

/**
 * Fetch a URL from the user's own machine.
 *
 * The point is the origin: this runs on the user's computer, from their home
 * IP, so it reaches pages that the model's own fetch — coming from a datacenter
 * with a bot user-agent — gets blocked on. The model should call this FIRST and
 * only fall back to its own browsing if this fails; that keeps the work on the
 * cheaper path.
 *
 * Deliberately generic. It returns structured data (JSON-LD) plus cleaned text,
 * and knows nothing about recipes specifically. Extraction quality for any one
 * kind of page is improved inside this module over time, not by the caller.
 */

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  /** How the content was obtained: a plain fetch, or a rendered browser. */
  method: "fetch" | "browser";
  title: string | null;
  /** Parsed schema.org / JSON-LD blocks — structured data when the page has it. */
  jsonLd: unknown[];
  /** Main readable text, tags stripped, capped to a token budget. */
  text: string;
  truncated: boolean;
}

/** Cap returned text so a 700 KB page cannot blow the model's context. */
const MAX_TEXT = 12_000;

/**
 * Below this much readable text, a plain fetch probably got a JS shell rather
 * than content, so it is worth paying for a rendered browser.
 */
const THIN_TEXT = 600;

/**
 * Refuse anything that is not a public http(s) URL.
 *
 * A tool that fetches arbitrary URLs from the user's machine must not be
 * usable to probe their loopback or LAN — a URL could arrive from a web page
 * the model is reading, not just from the user. This is the deterministic
 * guard, stated so the model knows the boundary.
 */
function publicUrlOrError(raw: string): Result<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return err("INPUT", `Ogiltig URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return err("INPUT", `Endast http/https stöds, inte ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) {
    return err("INPUT", `Interna adresser kan inte hämtas: ${host}`);
  }
  return ok(u);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Strip a page to readable text: no scripts, no tags, collapsed whitespace. */
function extractText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Turn block boundaries into newlines so lists survive tag stripping.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]!.trim()) : null;
}

/** Every application/ld+json block, parsed and flattened, failures skipped. */
function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && typeof parsed === "object" && "@graph" in parsed) {
        out.push(...(parsed["@graph"] as unknown[]));
      } else out.push(parsed);
    } catch {
      // A malformed block is not worth failing the whole fetch over.
    }
  }
  return out;
}

function cap(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT) return { text, truncated: false };
  return { text: text.slice(0, MAX_TEXT), truncated: true };
}

/** Plain fetch with a browser user-agent and a timeout. */
async function plainFetch(u: URL): Promise<Result<{ html: string; status: number; finalUrl: string }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMING.requestTimeoutMs);
  try {
    const res = await fetch(u, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "sv-SE,sv;q=0.9,en;q=0.8",
      },
      signal: controller.signal,
    });
    const html = await res.text();
    return ok({ html, status: res.status, finalUrl: res.url });
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    return err(
      "NETWORK",
      isAbort ? `timeout efter ${TIMING.requestTimeoutMs}ms` : String(e),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Render with a real browser so client-side pages yield their content. */
async function renderedFetch(u: URL): Promise<Result<{ html: string; finalUrl: string }>> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({ headless: HEADLESS, args: [...PUPPETEER_ARGS] });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(u.toString(), {
      waitUntil: "networkidle0",
      timeout: TIMING.requestTimeoutMs,
    });
    const html = await page.content();
    return ok({ html, finalUrl: page.url() });
  } catch (e) {
    return err("NETWORK", e instanceof Error ? e.message : String(e));
  } finally {
    await browser?.close();
  }
}

export interface FetchOptions {
  /** Force a rendered browser even when the plain fetch looks sufficient. */
  render?: boolean | undefined;
}

/**
 * Fetch a URL and return its structured data and readable text.
 *
 * Tries a plain fetch first; escalates to a rendered browser when the page
 * comes back too thin to be real content, or when `render` is set. Puppeteer is
 * already a dependency (login uses it), so the escalation costs nothing new.
 */
export async function fetchUrl(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<Result<FetchedPage>> {
  const checked = publicUrlOrError(rawUrl);
  if (!checked.ok) return checked;
  const u = checked.data;

  let method: FetchedPage["method"] = "fetch";
  let html: string;
  let status = 200;
  let finalUrl = u.toString();

  if (opts.render) {
    const r = await renderedFetch(u);
    if (!r.ok) return r;
    ({ html, finalUrl } = r.data);
    method = "browser";
  } else {
    const first = await plainFetch(u);
    if (!first.ok) return first;
    ({ html, status, finalUrl } = first.data);

    const previewText = extractText(html);
    // A JS-rendered page returns a shell: 200, but almost no readable text.
    if (previewText.length < THIN_TEXT) {
      log.info(`tunt svar (${previewText.length} tecken), renderar med webbläsare`);
      const rendered = await renderedFetch(u);
      if (rendered.ok) {
        html = rendered.data.html;
        finalUrl = rendered.data.finalUrl;
        method = "browser";
      }
      // If rendering fails, fall through with the thin plain-fetch content.
    }
  }

  const { text, truncated } = cap(extractText(html));

  return ok({
    url: rawUrl,
    finalUrl,
    status,
    method,
    title: extractTitle(html),
    jsonLd: extractJsonLd(html),
    text,
    truncated,
  });
}
