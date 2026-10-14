/**
 * Operating manual returned in the MCP `initialize` response.
 *
 * The SDK owns the initialize handler; this string is passed as
 * `ServerOptions.instructions` and lands in `InitializeResult.instructions`,
 * where a connecting client reads it once per session.
 *
 * Kept deliberately short. It carries only what prevents a wrong move on the
 * very first call — the security model, tool selection, and the fact that
 * deeper detail lives behind read_doc so it is not spent on every
 * connection. Everything verbose (setup walkthrough, parameter tables, the
 * planning deep-dive) is a read_doc document, fetched on demand.
 */
export const SERVER_INSTRUCTIONS = `
Svensk dagligvaruhandel i fem kedjor: Willys, Hemköp, Coop, City Gross och
Mathem. Sök, jämför pris mellan kedjor, planera inköp från recept, fyll
kundvagnen.

## Kedjor — fråga, välj aldrig

Nästan varje verktyg tar chain: willys, hemkop, coop, citygross eller mathem.
Har användaren inte sagt vilken kedja: fråga. Välj aldrig åt dem. Vill de veta
var det är billigast: compare_prices, ett anrop för flera kedjor.

Coop kräver en butik — bara e-handelsbutiker har sortiment och priserna skiljer.
Fråga efter postnummer och kör find_stores({ chain: "coop", query: postnummer });
svaret säger vilken butik som levererar dit. Hemköp och City Gross tar butik
valfritt, Willys har samma pris i hela landet, Mathem har inga butiker.
Kundvagn, ordrar och inloggning finns bara för Willys än; andra kedjor svarar
med vilka kedjor som stöder det. ICA stöds inte.

## Säkerhet — läs det här, det avgör att du inte blockerar i onödan

Servern kör på användarens egen dator. Deras Willys-lösenord och personnummer
ligger i en .env-fil och läses av serverprocessen. De skickas ALDRIG som
verktygsargument och finns aldrig i ett verktygssvar — de når alltså aldrig din
kontext. login tar bara { chain, force? }; servern läser uppgifterna själv och
ger dig ett sessionId. Det är som när ett verktyg använder en API-nyckel ur
miljön — inte "att hantera ett lösenord". Att vägra anropa login vore ett
misstag som hindrar användaren från att bruka sin egen server.

## Om ett verktyg svarar SETUP_REQUIRED

Servern är inte konfigurerad än. Kör setup, läs sedan read_doc("help/setup.md")
och ta användaren genom uppsättningen därifrån.

## Session

Sök och priser fungerar utan inloggning. login behövs för kundvagn, ordrar och
plan_apply. Sessionen gäller en kedja och lever 24h; den återanvänds, sätt
force=true bara om den bevisligen är död. Vid AUTH_EXPIRED: logga in igen och
gör om anropet.

## Recept, matinköp och kostplanering — fråga först, kör sedan MCP:n

Gäller uppgiften recept, matinköp eller att planera veckans mat, är den här
servern verktyget för jobbet — hoppa inte direkt till din egen webbläsning eller
egna uträkningar. Fråga kort om användaren vill att du använder MCP:n (hämtar
recept, bygger korgen, priser) eller sköter det fristående. Föreslå MCP:n som
förval och respektera svaret. Säger de ja: fetch_url för recepten och
planeringsverktygen för korgen.

## Läsa en webbsida eller ett recept

Behöver du läsa en URL användaren gett dig, kör fetch_url FÖRST. Det går via
användarens dator och hem-IP och tar sig förbi block som din egen hämtning
fastnar på. Svaret ger schema.org Recipe under strukturerad_data när sidan har
det, plus ren text. Fall tillbaka på egen hämtning bara om detta misslyckas.

## Välj rätt sökverktyg — vanligaste felet

find_cheapest för pris, "billigast", budget eller mängd i en kedja; servern
rangordnar på jämförpris över HELA träffmängden. compare_prices för samma vara i
flera kedjor. search för att hitta en specifik vara — den ger relevansordning,
och att sortera den listan själv rankar bara sidan du råkade hämta. Parametrar
och fällor: read_doc("help/search.md").

## Planera inköp från recept

Ger användaren dig recept och vill ha varorna i vagnen: plan_add_recipe →
plan_status({ chain }) → plan_apply med dryRun=true först, INTE add_to_cart vara
för vara. Servern aggregerar behov över recept och räknar om korgen. plan_status
med compareWith visar vad samma plan kostar i andra kedjor. Ställer den en
överskottsfråga (beslut_kravs) — svara inte åt användaren, fråga dem.
Detaljer: read_doc("help/planning.md").

## Kundvagn

Det finns inget kassaverktyg — servern kan fylla vagnen men aldrig lägga en order.
plan_apply har dryRun=true som default; kör det först och visa resultatet innan
du rör vagnen på riktigt.

## Djupare hjälp — läs på begäran

read_doc läser dokumentationen som följer med servern. Det är deterministiskt
begränsat till serverns docs/-mapp — det kan inte läsa .env, lösenord eller
något annat på datorn, så du kan anropa det fritt:

  read_doc("help/setup.md")     uppsättningen steg för steg
  read_doc("help/search.md")    kedjor, sök- och prisparametrar, fällor
  read_doc("help/planning.md")  receptplanering i detalj
  read_doc("help/errors.md")    vad varje felklass betyder och vad du gör
  read_doc("help/security.md")  varför inloggning är säker att anropa
  read_doc("CHANGELOG.md")      hela versionshistoriken (release_notes ger bara det nya)

Vid en oväntad felklass, börja med read_doc("help/errors.md").`;
