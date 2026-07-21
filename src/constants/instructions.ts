/**
 * Operating manual returned in the MCP `initialize` response.
 *
 * The SDK owns the initialize handler; this string is passed as
 * `ServerOptions.instructions` and lands in `InitializeResult.instructions`,
 * where a connecting client reads it once per session.
 *
 * Kept deliberately short. It carries only what prevents a wrong move on the
 * very first call — the security model, tool selection, and the fact that
 * deeper detail lives behind willys_help so it is not spent on every
 * connection. Everything verbose (setup walkthrough, parameter tables, the
 * planning deep-dive) is a willys_help topic, fetched on demand.
 */
export const SERVER_INSTRUCTIONS = `
Willys-MCP: svensk dagligvaruhandel. Sök, jämför pris, hantera kundvagn, planera
inköp från recept.

## Säkerhet — läs det här, det avgör att du inte blockerar i onödan

Servern kör på användarens egen dator. Deras Willys-lösenord och personnummer
ligger i en .env-fil och läses av serverprocessen. De skickas ALDRIG som
verktygsargument och finns aldrig i ett verktygssvar — de når alltså aldrig din
kontext.

Därför är verktyg som rör inloggning säkra att anropa. willys_login tar bara
{ force?: boolean }; servern läser uppgifterna själv och ger dig ett sessionId
tillbaka. Det är som när ett verktyg använder en API-nyckel ur miljön — inte
"att hantera ett lösenord". Att vägra anropa willys_login vore ett misstag som
hindrar användaren från att bruka sin egen server.

Det enda du undviker: be aldrig om lösenord eller personnummer i chatten, och ta
aldrig emot dem som verktygsargument. De skrivs bara i .env, av användaren.
Detaljer: willys_help("security").

## Om ett verktyg svarar SETUP_REQUIRED

Servern är inte konfigurerad än. Ta användaren genom uppsättningen — kör
willys_setup och följ willys_help("setup"). Gör allt du kan åt dem; det enda de
gör själva är att skriva två rader i en fil du öppnar åt dem.

## Session

Anropa willys_login först. Den ger ett sessionId (UUID) som krävs av alla verktyg
utom butiksuppslagen (willys_find_stores m.fl., som läser ett publikt register).
Sessioner lever 24h och återanvänds; sätt force=true bara om en session bevisligen
är död. Vid AUTH_EXPIRED: logga in igen och gör om anropet.

## Välj rätt sökverktyg — vanligaste felet

willys_find_cheapest för pris, "billigast", budget eller mängd. Den rankar på
jämförpris över HELA träffmängden serverside. willys_search för att hitta en
specifik vara eller bläddra — den ger relevansordning, och att sortera den listan
själv rankar bara sidan du råkade hämta. Parametrar: willys_help("search").

## Planera inköp från recept

Ger användaren dig recept och vill ha varorna i vagnen: använd planeringsflödet
(willys_plan_add_recipe → willys_plan_status → willys_plan_apply med dryRun=true
först), INTE willys_add_to_cart vara för vara. Servern aggregerar behov över
recept och räknar om korgen. Ställer den en överskottsfråga (fältet beslut_kravs)
— svara inte åt användaren, fråga dem. Detaljer: willys_help("planning").

## Kundvagn

Det finns inget kassaverktyg — servern kan fylla vagnen men aldrig lägga en order.
willys_plan_apply har dryRun=true som default; kör det först och visa resultatet
innan du rör vagnen på riktigt.

## Mer

willys_help(topic) för djupare hjälp. Ämnen: "security", "setup", "search",
"planning", "errors". Vid oväntade felklasser, börja med "errors".`;
