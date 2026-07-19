/**
 * stdio MCP servers speak JSON-RPC over stdout. Anything else written to
 * stdout corrupts the protocol stream and produces parse errors in the client
 * that look like random disconnects.
 *
 * The previous implementation called console.log() in ~90 places across the
 * request path. All diagnostics here go to stderr, which the client captures
 * as plain logs.
 */

type Level = "debug" | "info" | "warn" | "error";

const ENABLED: Record<Level, boolean> = {
  debug: process.env.WILLYS_LOG === "debug",
  info: process.env.WILLYS_LOG !== "silent",
  warn: true,
  error: true,
};

function emit(level: Level, msg: string, extra?: unknown): void {
  if (!ENABLED[level]) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  process.stderr.write(
    extra === undefined ? `${line}\n` : `${line} ${safe(extra)}\n`,
  );
}

function safe(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return "[unserializable]";
  }
}

/** Never log a full cookie string or token. */
export function redact(secret: string, keep = 12): string {
  return secret.length <= keep
    ? "***"
    : `${secret.slice(0, keep)}…(${secret.length} tecken)`;
}

export const log = {
  debug: (m: string, e?: unknown) => emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
