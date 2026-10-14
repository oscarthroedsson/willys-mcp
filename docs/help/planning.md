# Måltidsplanering — kundvagnen som projektion av recept

Serverns viktigaste flöde. Använd det när användaren ger dig recept och vill ha
varorna i kundvagnen. Lägg INTE i varor en och en med `add_to_cart` när
det handlar om recept — då tappas aggregeringen.

## Flödet

0. `fetch_url` — ger användaren dig recept som länkar, hämta var och en
   här först. Svaret ger schema.org Recipe (fältet `strukturerad_data`) med
   ingredienser och portionsantal, eller ren text att läsa dem ur. Räkna om
   till de portioner användaren vill laga innan nästa steg.
1. `plan_add_recipe` — ett anrop per recept, med dess ingredienser
2. `plan_status({ chain, ... })` — visa föreslagen korg, kostnad och beslutslägen
   i den kedjan
3. `plan_apply({ chain, sessionId, ... })` — `dryRun=true` först, sedan false
   efter godkännande

## Planen är kedjeoberoende, korgen är det inte

Behovsregistret (steg 1) hör inte till någon kedja. `plan_status` prissätter det
i `chain`, och med `compareWith: ["coop", "mathem"]` (Coop kräver butik i
`compareStores`) visas vad samma plan kostar i de andra kedjorna — utan att
något ändras. Övriga kedjors summa räknas med billigaste val per rad.

`plan_apply` lägger i kundvagnen och kräver en kedja med kundvagn, idag Willys.
Valen som gjorts sparas per kedja: en produktkod från Willys betyder inget hos
Coop, så att byta kedja börjar om valen utan att tappa behoven.

## Behov aggregeras, de staplas inte

Planen håller ett behovsregister. Tre recept som vill ha ägg blir EN rad: 13 st,
med härkomsten "Mån:6 + Ons:4 + Tors:3" utskriven. Nyckeln behoven slås ihop på
är söktermen i gemener — skriv "ägg" i alla tre recepten, inte "ägg", "Ägg" och
"färska ägg", annars blir det tre rader.

Lägger användaren till ett fjärde recept räknas HELA korgen om från registret.
Det kan mycket väl byta ut en produkt du redan lagt i vagnen — 6-packet som
räckte för 6 ägg är fel vara för 13. `plan_apply` skickar bara
differensen, så det är gratis att köra om efter varje nytt recept.

## Överskottsfrågan ska ställas, inte gissas

När billigaste sättet att täcka behovet ger mycket över, returnerar
`plan_status` ett fält `beslut_kravs` i stället för att välja:

> Ägg 24-pack är 7.80 kr billigare men ger 11 st över behovet. Ägg 10-pack ger
> bara 7 st över. Vill du ha det billigare med överskott?

Svara inte åt användaren — det är hushållets avvägning. Ställ frågan, och skicka
sedan svaret vidare:

- ja till överskott → `acceptSurplus: ["ägg"]`
- nej, håll det tajt → `preferTight: ["ägg"]`

Har användaren redan sagt "välj alltid billigast" kan du sätta `acceptSurplus`
direkt utan att fråga varje gång. Rader med obesvarad fråga hoppas över av
`plan_apply` — de hamnar aldrig i vagnen av misstag.

## Mängder

`amount` kräver enhet: "6 st", "400 g", "8 dl". Räkna om receptets mängd till
antalet portioner som faktiskt ska lagas innan du skickar den. Anger två recept
samma vara i olika måttslag ("2 st tomat" och "400 g tomat") går de inte att slå
ihop — svaret listar det som en konflikt och du får be användaren välja enhet.

## Kategori och mustContain gäller även här

Samma fällor som i `find_cheapest`. Sätt `category` för tvetydiga varor
och `mustContain` när söktermen riskerar att matcha fel — annars hamnar
hundtugget i korgen igen, den här gången utan att någon tittar.
