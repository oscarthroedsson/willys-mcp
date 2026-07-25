import { z } from "zod";
import {
  DEFAULT_PLAN_ID,
  PRODUCT_CODE_HINT,
  PRODUCT_CODE_PATTERN,
} from "../constants/index.js";

/**
 * Zod fragments shared across tool schemas.
 *
 * The MCP SDK does NOT validate arguments against the JSON schema a server
 * advertises — that schema is documentation, not enforcement. So every tool
 * parses its arguments with Zod before running; these are the reused pieces.
 */

export const sessionId = z
  .string()
  .uuid("sessionId måste vara ett UUID från willys_login");

/** Willys product codes look like 101175556_ST or 101253220_KG. */
export const productCode = z
  .string()
  .regex(PRODUCT_CODE_PATTERN, PRODUCT_CODE_HINT);

/**
 * Named shopping plan. Several can exist side by side (veckan, fest, storkok)
 * and they never share requirements.
 */
export const planId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[\w åäöÅÄÖ-]+$/, "plannamn får bara innehålla bokstäver, siffror och bindestreck")
  .default(DEFAULT_PLAN_ID)
  .describe(
    `Vilken plan behoven hör till. Default "${DEFAULT_PLAN_ID}". Använd ett eget ` +
      "namn för en separat inköpsomgång.",
  );

/** One ingredient line — shared by plan_add_recipe and plan_set_ingredient. */
export const ingredient = z
  .object({
    query: z
      .string()
      .min(1)
      .max(60)
      .describe(
        "Sökterm för varan, t.ex. \"ägg\" eller \"vispgrädde\". Detta är också " +
          "nyckeln behov slås ihop på — skriv samma term för samma vara i olika " +
          "recept, annars aggregeras de inte.",
      ),
    amount: z
      .string()
      .min(1)
      .max(30)
      .describe(
        "Mängd med enhet: \"6 st\", \"400 g\", \"8 dl\", \"1 kg\". Ett tal utan " +
          "enhet avvisas. Räkna om receptets mängd till portionerna du faktiskt " +
          "lagar innan du skickar den.",
      ),
    label: z
      .string()
      .max(60)
      .optional()
      .describe("Läsbar etikett för utskrift. Default: query."),
    category: z
      .string()
      .max(60)
      .optional()
      .describe(
        "Kategorifacett från willys_find_cheapest, t.ex. \"Mejeri\". Kraftigt " +
          "rekommenderad för varor vars namn är tvetydigt.",
      ),
    requireSwedishMeat: z
      .boolean()
      .default(false)
      .describe("Kräv svensk köttmärkning. Använd för kött och fågel."),
    mustContain: z
      .array(z.string().min(1).max(40))
      .max(5)
      .default([])
      .describe(
        "Ord produktnamnet måste innehålla (ordgräns/suffix). Sätt detta när " +
          "söktermen riskerar att matcha fel vara.",
      ),
    mustNotContain: z
      .array(z.string().min(1).max(40))
      .max(20)
      .default([])
      .describe(
        'Uteslut namn som innehåller dessa ord (max 20), t.ex. ["margarin",' +
          '"picklad","sås"]. Tar bort nära-missar.',
      ),
  })
  .strict();

/** Answers to surplus questions, keyed by ingredient. */
export function surplusKeys(description: string) {
  return z
    .array(z.string().min(1).max(60))
    .max(60)
    .default([])
    .describe(
      `${description} Nyckeln är ingrediensens sökterm i gemener, som den står i ` +
        'fältet nyckel i svaret från willys_plan_status. Skicka ["*"] för att ' +
        "gälla alla rader — användbart när användaren sagt \"billigast\" generellt.",
    );
}
