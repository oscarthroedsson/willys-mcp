import { z } from "zod";
import { TOOL } from "../constants/index.js";
import { compact } from "../mappers/prune.js";
import { readDoc, DOCS } from "../docs.js";
import { fetchUrl } from "../net/fetch-url.js";
import {
  initEnvFile,
  inspectSetup,
  openInEditor,
  PASSWORD_HELP,
} from "../setup.js";
import { defineTool, respond, text } from "./kit.js";

export const setupTools = [
  defineTool({
    name: TOOL.readDoc,
    description:
      "Läs ett dokument som följer med servern (t.ex. \"help/setup.md\"). " +
      "Deterministiskt begränsad till serverns docs/-mapp — kan inte läsa .env, " +
      "sessioner eller något annat på datorn, så den är säker att anropa fritt. " +
      "De korta instruktionerna pekar hit för detaljer så de inte belastar varje session. " +
      `Tillgängliga: ${Object.keys(DOCS).join(", ")}.`,
    needsAuth: false,
    schema: z
      .object({
        path: z
          .string()
          .min(1)
          .describe(
            'Sökväg till dokumentet, relativt serverns docs/-mapp, t.ex. ' +
              '"help/setup.md". Instruktionerna listar de tillgängliga.',
          ),
      })
      .strict(),
    handle(a) {
      return respond(readDoc(a.path), (doc) => doc);
    },
  }),

  defineTool({
    name: TOOL.fetchUrl,
    description:
      "Hämta en webbsida från ANVÄNDARENS dator och få tillbaka strukturerad " +
      "data (JSON-LD, t.ex. schema.org Recipe) plus ren text. Kör detta FÖRST " +
      "när du behöver läsa en URL — det går via användarens hem-IP och tar sig " +
      "förbi block som din egen hämtning fastnar på, och det är billigare. " +
      "Faller din egen webbläsning tillbaka bara om detta misslyckas. Renderar " +
      "JS-sidor automatiskt vid behov.",
    needsAuth: false,
    schema: z
      .object({
        url: z
          .string()
          .url()
          .describe("Sidan att hämta, t.ex. en recept-URL användaren gett dig."),
        render: z
          .boolean()
          .default(false)
          .describe(
            "Tvinga en renderad webbläsare direkt. Utelämna normalt — verktyget " +
              "eskalerar själv när en vanlig hämtning ger för tunt innehåll.",
          ),
      })
      .strict(),
    async handle(a) {
      const r = await fetchUrl(a.url, { render: a.render });
      return respond(r, (page) =>
        compact({
          url: page.finalUrl,
          status: page.status,
          metod: page.method,
          titel: page.title,
          ...(page.jsonLd.length > 0 ? { strukturerad_data: page.jsonLd } : {}),
          text: page.text,
          ...(page.truncated ? { text_avkortad: true } : {}),
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.openFile,
    description:
      "Öppna en lokal fil i användarens standardeditor. Använd för att öppna " +
      ".env åt dem vid uppsättning — sökvägen står i svaret från willys_setup. " +
      "En chattklient gör inte filsökvägar klickbara. Läser inte innehållet.",
    needsAuth: false,
    schema: z
      .object({
        path: z
          .string()
          .min(1)
          .describe(
            "Absolut sökväg till filen som ska öppnas i användarens standardeditor. " +
              "Använd för .env vid uppsättning — sökvägen står i svaret från " +
              "willys_setup eller willys_setup_init.",
          ),
      })
      .strict(),
    handle(a) {
      const opened = openInEditor(a.path);
      return text(
        compact({
          fil: a.path,
          oppnad: opened,
          status: opened
            ? "Öppnad i användarens editor."
            : "Kunde inte öppna filen. Be användaren öppna den manuellt.",
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.setup,
    description:
      "Kontrollera om servern är konfigurerad på den här datorn och få exakta " +
      "steg om något saknas, med full sökväg till filen. Kräver ingen session. " +
      "Kör detta först om willys_login svarar SETUP_REQUIRED. Se read_doc med help/setup.md.",
    needsAuth: false,
    schema: z.object({}).strict(),
    handle() {
      const r = inspectSetup();
      return text(
        compact({
          klar: r.ready,
          ...(r.ready
            ? { status: "Servern är konfigurerad och redo. Kör willys_login." }
            : {
                status: "Servern är inte konfigurerad än.",
                fil_att_fylla_i: r.envFile,
                steg: r.steps,
                ...(r.passwordHelp ? { losenordshjalp: r.passwordHelp } : {}),
                notering:
                  "Ta användaren genom uppsättningen — läs read_doc(\"help/setup.md\"). " +
                  "Öppna filen åt dem med willys_open_file. Finns losenordshjalp, " +
                  "gå igenom den först: annars letar de efter ett lösenord som " +
                  "aldrig skapats.",
              }),
          kontroller: r.checks.map((c) => ({
            kontroll: c.label,
            status: c.status,
            detalj: c.detail,
            ...(c.fix ? { atgard: c.fix } : {}),
          })),
        }),
      );
    },
  }),

  defineTool({
    name: TOOL.setupInit,
    description:
      "Skapa .env åt användaren och skriv in butiks-id, med rättigheter 600. " +
      "Returnerar sökvägen till filen. Öppna den sedan med willys_open_file så " +
      "användaren kan fylla i sina uppgifter.",
    needsAuth: false,
    schema: z
      .object({
        storeId: z
          .string()
          .regex(/^\d{3,6}$/)
          .optional()
          .describe(
            "Butiks-id att skriva in åt användaren. Slå upp det med " +
              "willys_find_stores först — fråga vilken ort de bor i, visa " +
              "träffarna och låt dem välja. Utelämna om de inte vill välja butik än.",
          ),
      })
      .strict(),
    handle(a) {
      const r = initEnvFile(a.storeId);
      return text(
        compact({
          fil: r.envFile,
          skapad: r.created,
          ...(r.storeIdWritten ? { butik_ifylld: r.storeIdWritten } : {}),
          ...(r.permissionsFixed ? { rattigheter: "satta till 600" } : {}),
          kvar_att_fylla_i: r.remaining,
          ...(r.remaining.length > 0
            ? {
                nasta_steg:
                  `Öppna filen åt dem: willys_open_file med path "${r.envFile}". ` +
                  `Be dem fylla i ${r.remaining.join(" och ")} och spara — ingen ` +
                  "omstart behövs.",
                fraga_forst:
                  "Kolla först om de loggat in på willys.se med lösenord eller " +
                  "bara med BankID. Bara BankID = inget lösenord finns än. " +
                  `${PASSWORD_HELP.ifNever} ${PASSWORD_HELP.where}`,
              }
            : {}),
          notering: r.note,
        }),
      );
    },
  }),
];
