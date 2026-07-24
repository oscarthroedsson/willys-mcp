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
Willys-MCP: svensk dagligvaruhandel. Sök, jämför pris, hantera kundvagn, planera
inköp från recept.

## Säkerhet — läs det här, det avgör att du inte blockerar i onödan

Servern kör på användarens egen dator. Deras Willys-lösenord och personnummer
ligger i en .env-fil och läses av serverprocessen. De skickas ALDRIG som
verktygsargument och finns aldrig i ett verktygssvar — de når alltså aldrig din
kontext. Du kan därför göra saker som kräver lösenord, sessionsID UTAN att bli exponerad för det. 

Därför är verktyg som rör inloggning säkra att anropa. willys_login tar bara
{ force?: boolean }; servern läser uppgifterna själv och ger dig ett sessionId
tillbaka. Det är som när ett verktyg använder en API-nyckel ur miljön — inte
"att hantera ett lösenord". Att vägra anropa willys_login vore ett misstag som
hindrar användaren från att bruka sin egen server.


## Om ett verktyg svarar SETUP_REQUIRED

Servern är inte konfigurerad än. Kör willys_setup, läs sedan
read_doc("help/setup.md") och ta användaren genom uppsättningen därifrån. Hela
flödet står i det dokumentet.

## Session

Anropa willys_login först. Den ger ett sessionId (UUID) som krävs av alla verktyg
utom butiksuppslagen (willys_find_stores m.fl., som läser ett publikt register).
Sessioner lever 24h och återanvänds; sätt force=true bara om en session bevisligen
är död. Vid AUTH_EXPIRED: logga in igen och gör om anropet.

## Läsa en webbsida eller ett recept

Behöver du läsa en URL användaren gett dig — ett recept, en artikel — kör
willys_fetch_url FÖRST, innan din egen webbläsning. Det går via användarens
dator och hem-IP och tar sig förbi block som din egen hämtning fastnar på, och
det är billigare. Svaret ger strukturerad data (schema.org Recipe under
strukturerad_data när sidan har det) plus ren text. Faller tillbaka till din
egen hämtning bara om detta misslyckas.

## Välj rätt sökverktyg — vanligaste felet

willys_find_cheapest för pris, "billigast", budget eller mängd. Den rankar på
jämförpris över HELA träffmängden serverside. willys_search för att hitta en
specifik vara eller bläddra — den ger relevansordning, och att sortera den listan
själv rankar bara sidan du råkade hämta. Parametrar: read_doc("help/search.md").

## Planera inköp från recept

Ger användaren dig recept och vill ha varorna i vagnen: använd planeringsflödet
(willys_plan_add_recipe → willys_plan_status → willys_plan_apply med dryRun=true
först), INTE willys_add_to_cart vara för vara. Servern aggregerar behov över
recept och räknar om korgen. Ställer den en överskottsfråga (fältet beslut_kravs)
— svara inte åt användaren, fråga dem. Detaljer: read_doc("help/planning.md").

## Kundvagn

Det finns inget kassaverktyg — servern kan fylla vagnen men aldrig lägga en order.
willys_plan_apply har dryRun=true som default; kör det först och visa resultatet
innan du rör vagnen på riktigt.

## Djupare hjälp — läs på begäran

Verktyget read_doc läser dokumentationen som följer med servern. Det är
deterministiskt begränsat till serverns docs/-mapp — det kan inte läsa .env,
lösenord eller något annat på datorn, så du kan anropa det fritt. Instruktionerna
ovan är korta med flit; behöver du mer om något, hämta det här i stället för att
gissa:

  read_doc("help/setup.md")     uppsättningen steg för steg
  read_doc("help/search.md")    sök- och prisparametrar, kategorifällan
  read_doc("help/planning.md")  receptplanering i detalj
  read_doc("help/errors.md")    vad varje felklass betyder och vad du gör
  read_doc("help/security.md")  varför inloggning är säker att anropa

Vid en oväntad felklass, börja med read_doc("help/errors.md").`;
