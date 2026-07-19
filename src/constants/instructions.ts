/**
 * Operating manual returned in the MCP `initialize` response.
 *
 * The SDK owns the initialize handler; this string is passed as
 * `ServerOptions.instructions` and lands in `InitializeResult.instructions`,
 * where a connecting client reads it once per session.
 *
 * It exists because the rules that make this server useful are not derivable
 * from the tool schemas. A model that has not been told about the compare-price
 * trap will call the wrong tool and confidently report the wrong answer. Keep
 * this dense — it is spent context on every connection.
 */
export const SERVER_INSTRUCTIONS = `

Willys-MCP: svensk dagligvaruhandel. Sök, jämför pris, hantera kundvagn och läs orderhistorik.

## Första gången: guida användaren genom uppsättningen

Servern körs på användarens egen dator och behöver deras Willys-konto i en
.env-fil. Svarar ett verktyg SETUP_REQUIRED: lämna INTE över en checklista och
gå vidare. Ta dem genom det, steg för steg, och gör allt du kan åt dem.

Så här:

1. Kör willys_setup för att se exakt vad som saknas.

2. Fråga vilken ort de bor i eller handlar i. Slå upp butiker med
   willys_find_stores, visa träffarna som en kort lista och låt dem välja.
   Det här är hjälp du faktiskt kan ge — de behöver aldrig leta upp ett
   butiks-id själva.

3. Kör willys_setup_init med det valda butiks-id:t. Den skapar .env, skriver in
   butiken och sätter rättigheterna till 600.

4. FRÅGA om de någonsin loggat in på willys.se med lösenord, eller bara med
   BankID. Det här steget får inte hoppas över — se nedan.

5. Visa sökvägen till .env som en KLICKBAR markdown-länk så de kan öppna filen
   direkt: fältet lank_att_visa i svaret är färdigformaterat. Be dem fylla i:

     WILLYS_USERNAME   personnummer (10 eller 12 siffror), eller
                       Willys Plus-nummer (16 siffror)
     WILLYS_PASSWORD   lösenordet till willys.se

   Spara, starta om servern i klienten.

6. När de säger att de är klara: kör willys_setup igen och bekräfta. Är
   användarnamnet fel format säger kontrollen exakt vad som är fel — förklara
   det vänligt och låt dem rätta.

### Har de bara använt BankID finns inget lösenord att fylla i

Det här är den vanligaste anledningen till att uppsättningen fastnar, och den
ser ut som ett tekniskt fel fast den inte är det. Servern loggar in genom att
fylla i ett formulär med användarnamn och lösenord. BankID går inte att
automatisera — det kräver att användaren signerar i telefonen vid varje anrop.

Så: har de aldrig satt ett lösenord på willys.se har de ingenting att skriva i
filen, och de kommer leta tills de ger upp. Säg det rakt ut, innan de öppnar
filen:

  "Servern kan bara logga in med lösenord, inte med BankID. Har du aldrig satt
   ett lösenord på willys.se behöver du skapa ett först — gå till
   https://www.willys.se/anvandare/inloggning och leta efter alternativet för
   glömt eller nytt lösenord. Har du inget konto alls börjar du på
   https://www.willys.se/registrera/privat/identifiera"

Hittar de inget sådant alternativ: be dem kontakta Willys kundtjänst och be om
lösenordsinloggning för kontot. Hitta INTE på en klickväg genom menyerna —
Willys ändrar sitt gränssnitt och en påhittad väg får dem att leta efter något
som inte finns där.

### Vad du ALDRIG gör

Fråga aldrig efter lösenord eller personnummer i chatten, och ta aldrig emot dem
som argument till ett verktyg. Allt du skickas hamnar i konversationen och i
loggarna bakom den. De två raderna skrivs bara direkt i filen, av användaren.

Säger de ändå sitt lösenord i chatten: använd det inte, och säg åt dem att byta
det, eftersom det nu ligger i historiken.

BankID stöds inte — kontot måste ha ett vanligt lösenord. Användarnamnet är
personnummer (10 eller 12 siffror) eller Willys Plus-nummer (16 siffror). En
e-postadress fungerar aldrig.

## Sessionsflöde

Anropa willys_login först. Den returnerar ett sessionId (UUID) som krävs av alla
verktyg utom butiksuppslagen. Sessioner lever 24 timmar och återanvänds
automatiskt — sätt force=true endast om en session bevisligen är död, eftersom
Willys stryper upprepade inloggningar.

Vid felklassen AUTH_EXPIRED: kör willys_login igen och gör om anropet.

Butiksverktygen (willys_find_stores, willys_nearest_stores, willys_get_store,
willys_refresh_stores) går mot ett publikt register och kräver inget sessionId.

## Välj rätt sökverktyg

willys_find_cheapest när frågan gäller pris, "billigast", budget eller mängd.
willys_search när frågan gäller att hitta en specifik vara eller bläddra sortiment.

Detta är den vanligaste felkällan. willys_search returnerar Willys relevansordning;
att sortera den listan själv rankar bara den sida du råkade hämta.
willys_find_cheapest sorterar på jämförpris (kr/kg, kr/l, kr/st) över HELA
träffmängden serverside och är det enda korrekta svaret på "billigast".

## willys_find_cheapest — parametrar

query          fritext, 0-200 tecken. Får vara tom om category anges.
category       facettvärde, t.ex. "Kött" eller "Fågel". Filtreras serverside.
onlySwedish    endast verifierad svensk ursprungsmärkning.
requireSwedishMeat  striktare: kräver meat_from_sweden/swedish_bird. Använd för kött.
excludeBrands  lista, max 20, t.ex. ["Eldorado","Garant"].
onlyBuyable    default true. Behåller endast köpbara varor.
mustContain    lista, max 5 ord. Produktnamnet måste innehålla samtliga.
need           behovstext, t.ex. "1.7 kg". Ger antal förpackningar och totalkostnad.
limit          1-25, default 10.

### Kategorier hittas, gissas inte

Kör först utan category. Svaret innehåller tillgangliga_kategorier med namn och
antal för just den frågan. Välj därifrån och kör om. Facetterna är per query —
en hårdkodad lista blir fel.

Varför det spelar roll: q="köttfärs" ger 37 träffar där den billigaste är en
Findus köttfärssås. Med category="Kött" ger samma fråga 29 träffar där den
billigaste faktiskt är köttfärs.

### mustContain skyddar mot självsäkert nonsens

Billigast-först över fritext matchar gärna något som delar ett ord och inget
annat. "torkad dragon" matchade ett torkat grisöra sålt som hundtugg, eftersom
det var billigast av allt som innehöll "torkad". Sätt mustContain när frågan
gäller en specifik vara.

### need ger riktig totalkostnad

Med need="1.7 kg" räknas antal förpackningar och total kostnad per kandidat, och
listan rangordnas om på vad behovet faktiskt kostar. Billigast per kg kan tvinga
fram en större förpackning än du behöver — svaret sätter då fältet notering.

## willys_search — parametrar

query          1-200 tecken.
page           0-indexerad, max 500.
size           1-50, default 20.
onlySwedish    filtrerar på verifierad svensk märkning, inte på varumärke.
onlyBuyable    default true.

## Kundvagn

Produktkoder har formen 101175556_ST eller 101253220_KG — suffixet är säljenhet
och ingår i koden. Hämta koden ur ett sökresultat; hitta aldrig på en.

willys_add_to_cart tar quantity 1-50. Taket är avsiktligt: kundvagnen är riktiga
pengar. Bekräfta med användaren innan du lägger i varor de inte har bett om.

Det finns inget kassaverktyg. Servern kan inte lägga en order.

## Måltidsplanering — kundvagnen som projektion av recept

Det här är serverns viktigaste flöde. Använd det när användaren ger dig recept och
vill ha varorna i kundvagnen. Lägg INTE i varor en och en med willys_add_to_cart
när det handlar om recept — då tappas aggregeringen.

Flödet:

1. willys_plan_add_recipe   — ett anrop per recept, med dess ingredienser
2. willys_plan_status       — visa föreslagen korg, kostnad och beslutslägen
3. willys_plan_apply        — dryRun=true först, sedan false efter godkännande

### Behov aggregeras, de staplas inte

Planen håller ett behovsregister. Tre recept som vill ha ägg blir EN rad: 13 st,
med härkomsten "Mån:6 + Ons:4 + Tors:3" utskriven. Nyckeln behoven slås ihop på är
söktermen i gemener — skriv "ägg" i alla tre recepten, inte "ägg", "Ägg" och
"färska ägg", annars blir det tre rader.

Lägger användaren till ett fjärde recept räknas HELA korgen om från registret.
Det kan mycket väl byta ut en produkt du redan lagt i vagnen — 6-packet som räckte
för 6 ägg är fel vara för 13. willys_plan_apply skickar bara differensen, så det
är gratis att köra om efter varje nytt recept.

### Överskottsfrågan ska ställas, inte gissas

När billigaste sättet att täcka behovet ger mycket över, returnerar
willys_plan_status ett fält beslut_kravs i stället för att välja:

  "Ägg 24-pack är 7.80 kr billigare men ger 11 st över behovet.
   Ägg 10-pack ger bara 7 st över. Vill du ha det billigare med överskott?"

Svara ALDRIG åt användaren. Ställ frågan, och skicka sedan svaret vidare:
  ja till överskott  -> acceptSurplus: ["ägg"]
  nej, håll det tajt -> preferTight: ["ägg"]

Har användaren redan sagt "välj alltid billigast" kan du sätta acceptSurplus
direkt utan att fråga varje gång. Rader med obesvarad fråga hoppas över av
willys_plan_apply — de hamnar aldrig i vagnen av misstag.

### Mängder

amount kräver enhet: "6 st", "400 g", "8 dl". Räkna om receptets mängd till antalet
portioner som faktiskt ska lagas innan du skickar den. Anger två recept samma vara
i olika måttslag ("2 st tomat" och "400 g tomat") går de inte att slå ihop —
svaret listar det som en konflikt och du får be användaren välja enhet.

### Kategori och mustContain gäller även här

Samma fällor som i willys_find_cheapest. Sätt category för tvetydiga varor och
mustContain när söktermen riskerar att matcha fel — annars hamnar hundtugget i
korgen igen, den här gången utan att någon tittar.

## Övrigt värt att veta

- willys_get_product_detail ger näringsvärde och ingredienser. En kod som inte
  finns returnerar NOT_FOUND (Willys svarar 400, inte 404, på den).
- willys_get_frequent_products läser faktisk orderhistorik. Ett anrop per
  genomsökt order, så scanOrders är kapat till 30 — håll det lågt.
- willys_get_campaigns kräver storeId, eller att WILLYS_STORE_ID är satt.
  Slå upp id med willys_find_stores.
- willys_get_orders är sidad; upp till 25 per anrop.

## Felklasser

AUTH_EXPIRED  logga in igen och gör om anropet.
INPUT         argumenten avvisades av schemat. Läs meddelandet och rätta.
NOT_FOUND     resursen finns inte. Kontrollera koden, försök inte igen oförändrat.
SHAPE         Willys har ändrat ett svarsformat. Servern ligger efter; rapportera
              det i stället för att tolka svaret.
UPSTREAM      Willys fel eller nätverksfel. Ett omförsök kan hjälpa.

Endpoints är kartlagda mot produktion utan officiellt publikt API och kan sluta
fungera utan förvarning.`;
