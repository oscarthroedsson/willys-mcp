import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { DB_PATH, PROJECT_ROOT } from "./config.js";
import { USERNAME_PATTERN } from "./constants/index.js";
import { loadEnv } from "./core/env.js";

/**
 * First-run diagnostics.
 *
 * An MCP server is installed by a human but driven by a model, and the model
 * cannot fix a missing password — it can only relay instructions. So a missing
 * .env must not surface as "login failed": it has to arrive as a checklist with
 * real paths on this machine, that the model can hand straight to the user.
 *
 * Nothing here reads a secret's value. Presence and shape only.
 */

export type CheckStatus = "ok" | "missing" | "invalid" | "warning";

export interface SetupCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** What the user must do. Absent when the check passed. */
  fix?: string;
}

export interface SetupReport {
  /** True when every blocking check passes — the server can actually be used. */
  ready: boolean;
  envFile: string;
  envExample: string;
  projectRoot: string;
  checks: SetupCheck[];
  /** Ordered, copy-pasteable steps. Empty when ready. */
  steps: string[];
  /**
   * Set when the password is missing. The account itself may be the blocker,
   * not the file, and that distinction has to reach the user before they go
   * hunting for a password that was never created.
   */
  passwordHelp?: {
    whatToFill: string;
    ifYouNeverSetOne: string;
    whereToSetIt: string;
    ifThatFails: string;
  };
}

const ENV_FILE = (): string =>
  process.env.WILLYS_ENV_FILE ?? path.join(PROJECT_ROOT, ".env");

function checkEnvFile(): SetupCheck {
  const file = ENV_FILE();
  if (!existsSync(file)) {
    return {
      id: "env_file",
      label: ".env finns",
      status: "missing",
      detail: `ingen .env på ${file}`,
      fix: `Kopiera ${path.join(PROJECT_ROOT, ".env.example")} till ${file} och fyll i den.`,
    };
  }

  // Credentials in a world-readable file is worth flagging, not blocking.
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) {
    return {
      id: "env_file",
      label: ".env finns",
      status: "warning",
      detail: `${file} har rättigheter ${mode.toString(8)} — läsbar för andra användare`,
      fix: `chmod 600 ${file}`,
    };
  }

  return {
    id: "env_file",
    label: ".env finns",
    status: "ok",
    detail: file,
  };
}

function checkUsername(): SetupCheck {
  const raw = process.env.WILLYS_USERNAME?.trim();
  if (!raw) {
    return {
      id: "username",
      label: "WILLYS_USERNAME",
      status: "missing",
      detail: "inte satt",
      fix:
        "Sätt WILLYS_USERNAME till ditt personnummer (10 eller 12 siffror) " +
        "eller ditt Willys Plus-nummer (16 siffror).",
    };
  }
  if (!USERNAME_PATTERN.test(raw)) {
    return {
      id: "username",
      label: "WILLYS_USERNAME",
      status: "invalid",
      detail: `${raw.length} tecken — matchar varken personnummer eller Plus-nummer`,
      fix:
        "Personnummer med 10 eller 12 siffror, eller Willys Plus-nummer med 16. " +
        "E-postadress fungerar inte: formuläret skickas aldrig och du får ett " +
        "missvisande 401 längre fram.",
    };
  }
  return {
    id: "username",
    label: "WILLYS_USERNAME",
    status: "ok",
    detail: `${raw.length} siffror`,
  };
}

/**
 * Willys' login is a Spring Security form post (j_username / j_password), so a
 * password must exist on the account. Anyone who has only ever used BankID does
 * not have one, and no amount of configuration will help until they create it —
 * which is why this fix text is about the account, not about the file.
 */
export const PASSWORD_HELP = {
  ifNever:
    "Har du aldrig loggat in med lösenord (bara BankID) finns det inget " +
    "lösenord att fylla i än — du måste skapa ett hos Willys först.",
  where:
    "Gå till https://www.willys.se/anvandare/inloggning och leta efter " +
    "alternativet för glömt eller nytt lösenord. Har du inget konto alls " +
    "börjar du på https://www.willys.se/registrera/privat/identifiera",
  fallback:
    "Hittar du inget sådant alternativ: kontakta Willys kundtjänst och be dem " +
    "aktivera lösenordsinloggning för kontot. Servern kan inte använda BankID — " +
    "den loggar in genom att fylla i ett formulär, och BankID kräver att du " +
    "signerar i din telefon vid varje anrop.",
} as const;

function checkPassword(): SetupCheck {
  const raw = process.env.WILLYS_PASSWORD;
  if (!raw || raw.trim().length === 0) {
    return {
      id: "password",
      label: "WILLYS_PASSWORD",
      status: "missing",
      detail: "inte satt",
      fix:
        "Sätt WILLYS_PASSWORD till ditt lösenord för willys.se. " +
        `${PASSWORD_HELP.ifNever} ${PASSWORD_HELP.where}`,
    };
  }
  return {
    id: "password",
    label: "WILLYS_PASSWORD",
    status: "ok",
    detail: "satt",
  };
}

function checkStoreId(): SetupCheck {
  const raw = process.env.WILLYS_STORE_ID?.trim();
  if (!raw) {
    return {
      id: "store_id",
      label: "WILLYS_STORE_ID",
      status: "warning",
      detail: "inte satt — bara willys_get_campaigns påverkas",
      fix:
        "Valfritt. Slå upp din butik med willys_find_stores (ortsnamn eller " +
        "postnummer) och sätt id:t i .env.",
    };
  }
  if (!/^\d{3,6}$/.test(raw)) {
    return {
      id: "store_id",
      label: "WILLYS_STORE_ID",
      status: "invalid",
      detail: `"${raw}" är inte ett butiks-id`,
      fix: "Butiks-id är 3–6 siffror. Slå upp med willys_find_stores.",
    };
  }
  return { id: "store_id", label: "WILLYS_STORE_ID", status: "ok", detail: raw };
}

function checkDatabase(): SetupCheck {
  const dir = path.dirname(DB_PATH);
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    return {
      id: "database",
      label: "Databas skrivbar",
      status: "invalid",
      detail: `kan inte skriva i ${dir}`,
      fix:
        `Ge skrivrättigheter till ${dir}, eller peka WILLYS_DB_PATH på en ` +
        "katalog du äger.",
    };
  }
  return {
    id: "database",
    label: "Databas skrivbar",
    status: "ok",
    detail: DB_PATH,
  };
}

/**
 * Puppeteer downloads a ~200 MB Chromium on install. If that step was skipped
 * or the cache was cleared, login fails deep inside the browser launch with a
 * message that says nothing about installation.
 */
function checkBrowser(): SetupCheck {
  const cacheRoot =
    process.env.PUPPETEER_CACHE_DIR ??
    path.join(process.env.HOME ?? "", ".cache", "puppeteer");

  if (!existsSync(cacheRoot)) {
    return {
      id: "browser",
      label: "Chromium nedladdad",
      status: "missing",
      detail: `ingen webbläsarcache på ${cacheRoot}`,
      fix:
        "Kör `npx puppeteer browsers install chrome` i projektkatalogen. " +
        "Inloggningen kräver en riktig webbläsare — Willys formulär går inte " +
        "att posta över vanlig HTTP.",
    };
  }
  return {
    id: "browser",
    label: "Chromium nedladdad",
    status: "ok",
    detail: cacheRoot,
  };
}

/** A check that blocks use, as opposed to one that merely degrades it. */
function blocking(c: SetupCheck): boolean {
  return c.status === "missing" || c.status === "invalid";
}

export function inspectSetup(): SetupReport {
  loadEnv();

  const checks = [
    checkEnvFile(),
    checkUsername(),
    checkPassword(),
    checkStoreId(),
    checkDatabase(),
    checkBrowser(),
  ];

  // store_id degrades one tool; it must never block the other eighteen.
  const blockers = checks.filter((c) => blocking(c) && c.id !== "store_id");

  const steps: string[] = [];
  if (blockers.length > 0) {
    const envFile = ENV_FILE();
    if (blockers.some((b) => b.id === "env_file")) {
      steps.push(
        `1. Kopiera ${path.join(PROJECT_ROOT, ".env.example")} till ${envFile}`,
      );
    }
    if (blockers.some((b) => b.id === "username" || b.id === "password")) {
      steps.push(
        `${steps.length + 1}. Öppna ${envFile} och fyll i WILLYS_USERNAME ` +
          "(personnummer, 10 eller 12 siffror) och WILLYS_PASSWORD",
      );
      steps.push(`${steps.length + 1}. Kör: chmod 600 ${envFile}`);
    }
    if (blockers.some((b) => b.id === "browser")) {
      steps.push(
        `${steps.length + 1}. Kör: npx puppeteer browsers install chrome`,
      );
    }
    if (blockers.some((b) => b.id === "database")) {
      steps.push(
        `${steps.length + 1}. Se till att ${path.dirname(DB_PATH)} är skrivbar`,
      );
    }
    // No restart step: loadEnv re-reads on mtime change, so saving is enough.
    steps.push(
      `${steps.length + 1}. Spara filen och säg till — ingen omstart behövs`,
    );
  }

  const passwordMissing = checks.some(
    (c) => c.id === "password" && c.status === "missing",
  );

  return {
    ready: blockers.length === 0,
    envFile: ENV_FILE(),
    envExample: path.join(PROJECT_ROOT, ".env.example"),
    projectRoot: PROJECT_ROOT,
    checks,
    steps,
    ...(passwordMissing
      ? {
          passwordHelp: {
            whatToFill:
              "WILLYS_USERNAME = personnummer (10 eller 12 siffror) eller " +
              "Willys Plus-nummer (16 siffror). WILLYS_PASSWORD = ditt " +
              "lösenord till willys.se.",
            ifYouNeverSetOne: PASSWORD_HELP.ifNever,
            whereToSetIt: PASSWORD_HELP.where,
            ifThatFails: PASSWORD_HELP.fallback,
          },
        }
      : {}),
  };
}

export interface InitResult {
  envFile: string;
  created: boolean;
  storeIdWritten: string | null;
  permissionsFixed: boolean;
  /** Variables the user must still fill in by hand. */
  remaining: string[];
  /** Whether the file was opened in the user's default editor. */
  opened: boolean;
  note: string;
}

/**
 * Open the .env in whatever the user edits text with.
 *
 * A chat client will not render a clickable file:// link — most block the
 * scheme outright — so printing an absolute path leaves the user to go hunting
 * through Finder for a dotfile, which is hidden by default. The server runs on
 * their machine, so it can just open it.
 *
 * Best effort: a failure here is not a setup failure, it only means they have
 * to open the file themselves.
 */
export function openInEditor(file: string): boolean {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    const child = spawn(cmd, [file], {
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepare .env as far as it can be prepared without handling a secret.
 *
 * Creates the file from the template, writes the store id the model looked up,
 * and locks the permissions down. What it deliberately does NOT do is accept a
 * password or a personnummer as an argument: tool arguments travel through the
 * conversation, so anything passed here would be written to the transcript and
 * whatever logs sit behind it. Those two lines stay a local edit, and the model
 * hands over a path instead of asking for a value.
 */
export function initEnvFile(storeId?: string, open = true): InitResult {
  const file = ENV_FILE();
  const template = path.join(PROJECT_ROOT, ".env.example");

  let created = false;
  if (!existsSync(file)) {
    const seed = existsSync(template)
      ? readFileSync(template, "utf8")
      : "WILLYS_USERNAME=\nWILLYS_PASSWORD=\nWILLYS_STORE_ID=\n";
    writeFileSync(file, seed, { mode: 0o600 });
    created = true;
  }

  let storeIdWritten: string | null = null;
  if (storeId && /^\d{3,6}$/.test(storeId)) {
    const current = readFileSync(file, "utf8");
    const updated = current.includes("WILLYS_STORE_ID=")
      ? current.replace(/^WILLYS_STORE_ID=.*$/m, `WILLYS_STORE_ID=${storeId}`)
      : `${current.trimEnd()}\nWILLYS_STORE_ID=${storeId}\n`;
    writeFileSync(file, updated, { mode: 0o600 });
    storeIdWritten = storeId;
  }

  let permissionsFixed = false;
  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) {
    chmodSync(file, 0o600);
    permissionsFixed = true;
  }

  // Re-read from disk rather than trusting process.env: loadEnv() may have
  // cached an earlier state, and what matters is what the file now says.
  const contents = readFileSync(file, "utf8");
  const isBlank = (key: string): boolean => {
    const m = new RegExp(`^${key}=(.*)$`, "m").exec(contents);
    return !m || m[1]!.trim().length === 0;
  };

  const remaining: string[] = [];
  if (isBlank("WILLYS_USERNAME")) remaining.push("WILLYS_USERNAME");
  if (isBlank("WILLYS_PASSWORD")) remaining.push("WILLYS_PASSWORD");

  // Only worth opening when something is actually left to type.
  const opened = open && remaining.length > 0 ? openInEditor(file) : false;

  return {
    envFile: file,
    created,
    storeIdWritten,
    permissionsFixed,
    remaining,
    opened,
    note:
      remaining.length === 0
        ? "Allt ifyllt. Kör willys_login — ingen omstart behövs."
        : "Fråga ALDRIG efter lösenord eller personnummer i chatten — de ska " +
          "bara skrivas i filen.",
  };
}

/**
 * Guard for tools that cannot work unconfigured.
 *
 * Returns null when the server is usable, or a ready-made message naming the
 * exact file to edit when it is not.
 */
export function setupBlocker(): string | null {
  const report = inspectSetup();
  if (report.ready) return null;

  const missing = report.checks
    .filter((c) => blocking(c) && c.id !== "store_id")
    .map((c) => c.label)
    .join(", ");

  return (
    `Servern är inte konfigurerad på den här datorn. Saknas: ${missing}. ` +
    `Kör willys_setup för fullständiga steg — filen som ska fyllas i är ${report.envFile}.`
  );
}
