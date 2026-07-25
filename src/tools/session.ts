import { z } from "zod";
import { TOOL } from "../constants/index.js";
import { explain } from "../core/result.js";
import { log } from "../core/logger.js";
import {
  harvestCookies,
  readCredentials,
  verifySession,
} from "../auth/login.js";
import {
  createSession,
  deleteSession,
  findValidSession,
  getCookies,
  purgeExpired,
} from "../auth/session.js";
import { setupBlocker } from "../setup.js";
import { defineTool, failure, text } from "./kit.js";
import { sessionId } from "./schema-parts.js";

export const sessionTools = [
  defineTool({
    name: TOOL.login,
    description:
      "Logga in på Willys och få ett sessionId tillbaka. Säkert att anropa: " +
      "servern läser uppgifterna ur .env, de når aldrig din kontext (se " +
      "read_doc med help/security.md). Återanvänder en giltig session (24h); " +
      "force=true tvingar ny inloggning.",
    needsAuth: false,
    schema: z
      .object({
        force: z
          .boolean()
          .default(false)
          .describe(
            "Tvinga ny inloggning även om en giltig session finns. Använd sparsamt — Willys stryper upprepade inloggningar.",
          ),
      })
      .strict(),
    async handle(a) {
      // Nothing the model can send fixes a missing password. Say so once,
      // pointing at the file, instead of failing inside Puppeteer.
      const blocker = setupBlocker();
      if (blocker) return failure(`${blocker} (SETUP_REQUIRED)`);

      // Re-use a live session rather than authenticating again. Willys
      // throttles repeated logins, and sessions are valid for 24 hours, so a
      // fresh Puppeteer run per call is both slow and self-defeating.
      if (!a.force) {
        const existing = findValidSession();
        if (existing) {
          // Our TTL is bookkeeping, not proof. Willys expires sessions on its
          // own schedule, so confirm upstream before handing this back —
          // otherwise the caller gets a session that reads as anonymous.
          const stillGood = await verifySession(existing.cookies);
          if (stillGood.ok) {
            return text(
              `Återanvände befintlig session: ${existing.id}\n` +
                `Sätt force=true om du behöver logga in på nytt.`,
            );
          }
          log.info(
            `lagrad session ${existing.id} är död uppströms, loggar in på nytt`,
          );
          deleteSession(existing.id);
        }
      }

      const creds = readCredentials();
      if (!creds.ok) return failure(`${explain(creds.kind)} — ${creds.message}`);

      const cookies = await harvestCookies(creds.data);
      if (!cookies.ok)
        return failure(`${explain(cookies.kind)} — ${cookies.message}`);

      purgeExpired();
      const id = createSession(cookies.data);
      return text(
        `Inloggad. sessionId: ${id}\nAnvänd detta i alla efterföljande anrop. Giltig 24h.`,
      );
    },
  }),

  defineTool({
    name: TOOL.checkAuth,
    description: "Kontrollera om en session fortfarande är giltig.",
    needsAuth: false,
    schema: z.object({ sessionId }).strict(),
    handle(a) {
      return getCookies(a.sessionId)
        ? text("Sessionen är giltig.")
        : failure("Sessionen har gått ut eller finns inte. (AUTH_EXPIRED)");
    },
  }),

  defineTool({
    name: TOOL.logout,
    description: "Avsluta sessionen.",
    needsAuth: false,
    schema: z.object({ sessionId }).strict(),
    handle(a) {
      deleteSession(a.sessionId);
      return text("Utloggad.");
    },
  }),
];
