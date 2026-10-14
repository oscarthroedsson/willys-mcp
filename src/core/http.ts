import { randomUUID } from "node:crypto";
import {
  ACCEPT_LANGUAGE,
  axfoodEndpoints,
  WILLYS,
  type AxfoodSite,
  JSON_CONTENT_TYPE,
  NEWRELIC,
  SEC_CH_UA,
  STATUS,
  TIMING,
  USER_AGENT,
} from "../constants/index.js";
import { log, redact } from "./logger.js";
import { err, ok, type Result } from "./result.js";


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, capped at 30s. */
function backoff(attempt: number): number {
  const exp = TIMING.baseDelayMs * 2 ** attempt;
  return Math.min(exp * (0.5 + Math.random() * 0.5), TIMING.maxBackoffMs);
}

/**
 * NewRelic browser-tracking headers. Willys' edge rejects or degrades requests
 * that lack them, so this is load-bearing rather than cosmetic.
 */
function trackingHeaders(): Record<string, string> {
  const traceId = randomUUID().replace(/-/g, "");
  const spanId = traceId.slice(0, 16);
  const ts = Date.now();
  const payload = {
    v: [0, 1],
    d: {
      ty: "Browser",
      ac: NEWRELIC.accountId,
      ap: NEWRELIC.appId,
      id: spanId,
      tr: traceId,
      ti: ts,
    },
  };
  return {
    newrelic: Buffer.from(JSON.stringify(payload)).toString("base64"),
    traceparent: `00-${traceId}-${spanId}-01`,
    tracestate: `${NEWRELIC.accountId}@nr=0-1-${NEWRELIC.accountId}-${NEWRELIC.appId}-${spanId}----${ts}`,
  };
}

export function apiHeaders(
  cookies: string,
  csrfToken?: string,
): Record<string, string> {
  const h: Record<string, string> = {
    accept: "*/*",
    "accept-language": ACCEPT_LANGUAGE,
    "cache-control": "no-cache",
    "content-type": JSON_CONTENT_TYPE,
    cookie: cookies,
    pragma: "no-cache",
    priority: "u=1, i",
    "sec-ch-ua": SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": USER_AGENT,
    ...trackingHeaders(),
  };
  if (csrfToken) h["x-csrf-token"] = csrfToken;
  return h;
}

/**
 * Headers for chains that are not Axfood. Coop, City Gross and Mathem answer a
 * plain JSON request; the Willys fingerprint (NewRelic, same-origin fetch
 * metadata) is Axfood-specific and only noise elsewhere.
 */
function plainHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    accept: "application/json",
    "accept-language": ACCEPT_LANGUAGE,
    "content-type": JSON_CONTENT_TYPE,
    "user-agent": USER_AGENT,
    ...extra,
  };
}

export interface RequestOpts {
  method?: "GET" | "POST" | "PUT";
  /** Session cookies. Empty string for anonymous calls. */
  cookies?: string;
  csrfToken?: string;
  body?: unknown;
  /**
   * "axfood" sends the Willys browser fingerprint; "plain" a bare JSON request
   * with these extra headers. Default "axfood" so existing callers are unchanged.
   */
  profile?: "axfood" | "plain";
  headers?: Record<string, string>;
  /** Who answered, for error text the model reads: "Willys", "Coop" … */
  label?: string;
}

/**
 * Single entry point for every upstream call.
 *
 * Returns Result rather than throwing, and — critically — checks content-type
 * before parsing. The dead slot endpoints answer 404 with an 80 KB HTML page;
 * parsing that as JSON produces an unreadable syntax error instead of an
 * honest NOT_FOUND.
 */
export async function request<T = unknown>(
  url: string,
  opts: RequestOpts,
): Promise<Result<T>> {
  const {
    method = "GET",
    cookies = "",
    csrfToken,
    body,
    profile = "axfood",
    headers,
    label = "Willys",
  } = opts;

  let lastError = "inga försök gjordes";

  for (let attempt = 0; attempt <= TIMING.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMING.requestTimeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers:
          profile === "plain"
            ? plainHeaders(headers)
            : { ...apiHeaders(cookies, csrfToken), ...headers },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      clearTimeout(timer);

      if (res.status === STATUS.unauthorized || res.status === STATUS.forbidden) {
        return err("AUTH_EXPIRED", `${label} svarade ${res.status}`, res.status);
      }

      if (res.status >= STATUS.serverError || res.status === STATUS.tooManyRequests) {
        lastError = `serverfel ${res.status}`;
        if (attempt < TIMING.maxRetries) {
          const d = backoff(attempt);
          log.warn(`försöker igen om ${Math.round(d)}ms`, {
            url,
            status: res.status,
          });
          await sleep(d);
          continue;
        }
        return err("UPSTREAM", lastError, res.status);
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes(JSON_CONTENT_TYPE)) {
        // A 404 here means the route is gone, not that the resource is missing.
        return err(
          res.status === STATUS.notFound ? "NOT_FOUND" : "SHAPE",
          `förväntade JSON, fick "${ct.split(";")[0]}" (${res.status})`,
          res.status,
        );
      }

      if (!res.ok) {
        return err("UPSTREAM", `${label} svarade ${res.status}`, res.status);
      }

      return ok((await res.json()) as T);
    } catch (e) {
      clearTimeout(timer);
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastError = isAbort
        ? `timeout efter ${TIMING.requestTimeoutMs}ms`
        : e instanceof Error
          ? e.message
          : String(e);

      if (attempt < TIMING.maxRetries) {
        const d = backoff(attempt);
        log.warn(`nätverksfel, försöker igen om ${Math.round(d)}ms`, lastError);
        await sleep(d);
        continue;
      }
      return err("NETWORK", lastError);
    }
  }

  return err("NETWORK", lastError);
}

/** CSRF token is returned as a bare JSON string (36 chars, verified). */
export async function fetchCsrf(
  cookies: string,
  site: AxfoodSite = WILLYS,
): Promise<Result<string>> {
  const res = await request<unknown>(axfoodEndpoints(site).csrf, {
    cookies,
    label: site.label,
  });
  if (!res.ok) return res;

  const raw = res.data;
  const token =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object" && "token" in raw
        ? String((raw as { token: unknown }).token)
        : null;

  if (!token) return err("SHAPE", "CSRF-token i okänt format");
  log.debug("csrf hämtad", redact(token));
  return ok(token);
}
