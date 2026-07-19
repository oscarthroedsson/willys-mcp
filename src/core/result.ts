/**
 * Explicit results instead of swallowed errors.
 *
 * The previous implementation caught errors and returned [] or null in six
 * places, which made "your session expired", "the network failed" and "you
 * have no orders" indistinguishable. In a shopping tool that is the difference
 * between trusting an empty cart and ordering everything twice.
 */

export type ErrorKind =
  /** 401/403 — the caller must re-authenticate. Never conflate with "empty". */
  | "AUTH_EXPIRED"
  /** 404 — upstream route is gone (three of them already are). */
  | "NOT_FOUND"
  /** 5xx after retries. */
  | "UPSTREAM"
  /** Response did not match the schema — upstream changed shape. */
  | "SHAPE"
  /** Transport failure or timeout. */
  | "NETWORK"
  /** Caller supplied invalid arguments. */
  | "INPUT"
  /**
   * The server is not configured on this machine yet.
   *
   * Distinct from INPUT because nothing the model can send will fix it — a
   * human has to edit a file on disk. Conflating the two makes the model retry
   * with different arguments forever.
   */
  | "SETUP_REQUIRED";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ErrorKind; message: string; status?: number };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = <T = never>(
  kind: ErrorKind,
  message: string,
  status?: number,
): Result<T> =>
  status === undefined
    ? { ok: false, kind, message }
    : { ok: false, kind, message, status };

/** Map an error kind to guidance the model can act on. */
export function explain(kind: ErrorKind): string {
  switch (kind) {
    case "AUTH_EXPIRED":
      return "Sessionen har gått ut. Kör willys_login igen.";
    case "NOT_FOUND":
      return "Endpointen finns inte längre hos Willys.";
    case "UPSTREAM":
      return "Willys svarade med serverfel efter omförsök.";
    case "SHAPE":
      return "Willys svarade i ett oväntat format.";
    case "NETWORK":
      return "Nätverksfel mot Willys.";
    case "INPUT":
      return "Ogiltiga argument.";
    case "SETUP_REQUIRED":
      return "Servern är inte konfigurerad än. Kör willys_setup och visa stegen för användaren.";
  }
}
