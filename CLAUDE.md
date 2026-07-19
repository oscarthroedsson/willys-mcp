# CLAUDE.md

Vägledning för Claude Code när du arbetar i det här repot.

## Kommandon

```bash
npm run typecheck      # tsc --noEmit — enda verkliga porten före commit
npm run mcp            # kör servern på stdio
npm run smoke          # tests/smoke.ts, spawnar servern och kör riktiga anrop
npm run test:volume    # ren matte, inget nätverk
npm run test:coverage  # täckningsoptimeraren, inget nätverk
npm run test:planner   # behovsregistret, inget nätverk (egen plan-id)
```

Det finns ingen unit-testsvit och inget byggsteg — `tsx` kör TypeScript direkt.
`typecheck` är därför den enda automatiska kontrollen. Kör den alltid efter en
ändring.

`npm run smoke` kräver giltiga uppgifter i `.env` och gör riktiga anrop mot
Willys. Den lägger inte något i kundvagnen, men den loggar in.

## Språk

Kod, kommentarer och användarvänd text är på svenska. Verktygsbeskrivningar,
felmeddelanden och `instructions`-strängen läses av en modell och ska vara
lika precisa som kommentarerna.

## Konventioner

**Inga kastade undantag i uppströmslagret.** Allt som kan misslyckas returnerar
`Result<T>` från `core/result.ts`. Felklassen (`AUTH_EXPIRED`, `SHAPE`,
`NOT_FOUND`, `UPSTREAM`, `INPUT`) ska överleva hela vägen till verktygssvaret —
den är det modellen agerar på.

**En fil per uppströmsresurs.** `src/upstream/` har en modul per resurs och en
barrel i `index.ts`. Lägg inte tillbaka blandade ansvar i en gemensam klientfil.

**Verktygsnamn deklareras en gång**, i `constants/tools.ts`. Manifestet och
dispatch-switchen härleds båda därifrån, och `default`-grenen i switchen tilldelar
`never` — lägger du till ett verktyg utan att hantera det så kompilerar det inte.
Ta inte bort den raden.

**Zod-scheman är enforcement.** MCP-SDK:n validerar inte inkommande argument.
Varje nytt verktyg måste ha ett `Inputs`-schema med `.strict()`, och numeriska
fält som styr pengar eller anropsvolym måste ha ett tak.

**Endpoints med build-hash är tidsinställda bomber.** Willys Next.js-rutter
(`_next/data/{buildId}/...`) roterar vid varje deploy. Använd REST-rutterna under
`/axfood/rest/`. Döda endpoints raderas inte utan flyttas till `DEAD_ENDPOINTS`
med datum, så att ingen återinför dem.

**Planeraren räknar om, den patchar inte.** `buildPlan` härleder alltid hela
korgen ur behovsregistret. Frestelsen att uppdatera en enskild rad inkrementellt
förstör hela poängen — det är omräkningen som gör att 6-packet byts mot ett
15-pack när behovet växer. `applyPlan` skickar sedan bara differensen.

**Servern väljer inte åt användaren när avvägningen är verklig.** Överskott mot
pris returneras som ett beslutsläge, aldrig som ett tyst val. Samma princip
gäller måttslagskonflikter och ogiltiga kategorifacetter: säg vad som hände och
vad alternativen är, gissa inte.

**Svar beskärs mot kontextbudget.** `mappers/prune.ts` finns för att uppströms
skickar 45 KB där modellen behöver 2 KB. Returnera inte råa uppströmsobjekt.

## Fallgropar som redan kostat tid

- `sort=price:asc` rankar en portionsrätt på 16 kr över ett kilo köttfärs på
  69 kr. Använd `compareprice:asc`.
- Facettfilter ligger i `q`, inte i en egen parameter: `q=köttfärs:category:Kött`.
- Fritextsök utan `mustContain` ger självsäkert nonsens — "torkad dragon"
  matchade ett hundtugg eftersom det var billigast med ordet "torkad".
- Produktnäringsvärden ligger i `nutritionsFactList`, inte `nutritionFacts`
  (som är tom sträng på varje produkt som inspekterats).
- Willys svarar 400, inte 404, för en produktkod som inte finns.
- Kundvagnen har ingen delete-endpoint; borttagning är en add med `quantity: 0`.
- Willys stryper upprepade inloggningar. Återanvänd sessionen (24h TTL) och
  verifiera den uppströms i stället för att logga in på nytt.

## Hemligheter

`.env`, `.credentials` och `willys.db*` är gitignorerade och ska förbli det.
Committa aldrig cookies, personnummer eller sessionsdatabasen.
