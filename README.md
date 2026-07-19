# willys-mcp

En [MCP](https://modelcontextprotocol.io)-server som ger en språkmodell tillgång
till Willys: produktsökning, jämförprisrankning, kundvagn, orderhistorik och
butiksregister.

Servern pratar stdio och är byggd mot Willys egna REST-endpoints (SAP Hybris).
Inloggningen sker via Puppeteer eftersom formuläret kräver en riktig webbläsare;
allt därefter går över vanliga HTTP-anrop med de skördade cookies.

## Vad den kan

| Område | Verktyg |
| --- | --- |
| Session | `willys_login`, `willys_check_auth`, `willys_logout` |
| Sök | `willys_search`, `willys_search_suggestions`, `willys_find_cheapest` |
| Produkt | `willys_get_product_detail` |
| Kundvagn | `willys_get_cart`, `willys_add_to_cart`, `willys_remove_from_cart` |
| Order | `willys_get_orders`, `willys_get_order_details`, `willys_get_frequent_products` |
| Butik | `willys_find_stores`, `willys_nearest_stores`, `willys_get_store`, `willys_refresh_stores` |
| Kampanj | `willys_get_campaigns` |
| Planering | `willys_plan_add_recipe`, `willys_plan_remove_recipe`, `willys_plan_status`, `willys_plan_apply`, `willys_plan_clear` |

Den intressanta är `willys_find_cheapest`. Willys Solr-lager sorterar på
jämförpris (kr/kg, kr/l, kr/st) över hela träffmängden i ett enda anrop, och
facettfiltret kodas in i `q` som `text:category:Kött`. Det gör att rankningen
blir korrekt i stället för "billigast av de 20 vi råkade hämta".

## Måltidsplanering

Planeringsverktygen behandlar kundvagnen som en **projektion av vad recepten
kräver**, inte som en hög varor någon lagt i en gång.

```
recept  →  behovsregister  →  optimal korg  →  diff mot vagnen  →  ändringar
             ägg: 13 st          1× 15-pack       har 1× 6-pack       byt ut
             (Mån:6 Ons:4 Tors:3)
```

Varje nytt recept räknar om hela korgen från registret. Lägger du till två
recept som vill ha sju ägg till blir behovet 13, och servern byter ut 6-packet
mot ett 15-pack i stället för att stapla på ett till. `willys_plan_apply`
skickar bara differensen, så det är gratis att köra om efter varje recept.

**Täckning optimeras på riktiga pengar, inte på jämförpris.** Du kan inte köpa
13 ägg, bara förpackningar av dem. Modulen räknar igenom varje sätt att täcka
behovet och rangordnar på total kostnad — tre 6-pack kan förlora mot ett
24-pack trots sämre kr/st.

**Överskott är en fråga, inte ett beslut.** Ger billigaste vägen mer än 50 %
över behovet, och finns ett märkbart tätare alternativ, returnerar servern ett
beslutsläge i stället för att välja:

> Ägg 24-pack är 7,80 kr billigare men ger 11 st över behovet. Ägg 10-pack ger
> bara 7 st över. Vill du ha det billigare med överskott?

Svaret skickas tillbaka som `acceptSurplus: ["ägg"]` eller `preferTight: ["ägg"]`.
Obesvarade rader hoppas över av `plan_apply` — de hamnar aldrig i vagnen av
misstag.

**Konflikter tystas inte.** Två recept som vill ha "2 st tomat" och "400 g tomat"
går inte att slå ihop utan att gissa vad en tomat väger. Raden blir en konflikt
att lösa, inte en felaktig summa.

## Kom igång

```bash
npm install
cp .env.example .env    # fyll i användarnamn och lösenord
npm run mcp
```

### Konfiguration

`.env` styr allt. Se `.env.example` för hela listan.

| Variabel | Krävs | Beskrivning |
| --- | --- | --- |
| `WILLYS_USERNAME` | ja | Personnummer (10 eller 12 siffror) eller Willys Plus-nummer (16 siffror). E-post fungerar inte — formuläret skickas aldrig. |
| `WILLYS_PASSWORD` | ja | Lösenordet till kontot. |
| `WILLYS_STORE_ID` | nej | Standardbutik för kampanjer. Slå upp med `willys_find_stores`. |
| `WILLYS_LOG` | nej | `debug` eller `silent`. |
| `WILLYS_HEADFUL` | nej | `1` visar webbläsaren vid inloggning, användbart vid felsökning. |
| `WILLYS_DB_PATH` | nej | Alternativ sökväg till sessions- och butikscachen. |

### Koppla in i en MCP-klient

```json
{
  "mcpServers": {
    "willys": {
      "command": "npx",
      "args": ["tsx", "/absolut/sokvag/willys-mcp/src/index.ts"]
    }
  }
}
```

Servern skickar med en `instructions`-sträng i sitt `initialize`-svar, så en
ansluten modell får sökregler, facettsyntax och gränsvärden automatiskt utan att
du behöver upprepa dem i systemprompten.

## Arkitektur

```
src/
├── index.ts          MCP-entrypoint: transport, dispatch, felgränser
├── config.ts         miljöhärledd konfiguration
├── tools/
│   └── registry.ts   Zod-kontrakt + verktygsmanifest (en sanningskälla)
├── planner/          måltidsplanering ovanpå upstream
│   ├── ledger.ts     behovsregister med härkomst per recept
│   └── reconcile.ts  bygger korgen och diffar mot vagnen
├── upstream/         HTTP-klienter mot Willys, en fil per resurs
│   ├── search.ts     fritextsök och autocomplete
│   ├── products.ts   produktdetalj
│   ├── cart.ts       läsa och ändra kundvagn
│   ├── orders.ts     orderhistorik och vanligaste varor
│   ├── customer.ts   kundprofil
│   ├── campaigns.ts  butiksspecifika erbjudanden
│   ├── cheapest.ts   jämförprisrankning med facetter och förpackningsmatte
│   ├── stores.ts     butiksregister med lokal cache
│   ├── schemas.ts    Zod-scheman för uppströmssvar
│   └── parse.ts      delad shape-validering
├── auth/             Puppeteer-inloggning och sessionslagring
├── core/             http, result, logger, env
├── domain/           produkt-, volym- och täckningsmatte (rena funktioner)
├── mappers/          svarsbeskärning mot kontextbudget
└── constants/        endpoints, gränsvärden, etiketter, verktygsnamn
```

Två designval förtjänar en förklaring:

**Result i stället för throw.** Alla uppströmsanrop returnerar `Result<T>` med en
felklass (`AUTH_EXPIRED`, `SHAPE`, `NOT_FOUND`, `UPSTREAM`). Verktygssvaren
behåller klassen, så modellen kan skilja "sessionen dog" från "Willys ligger
nere" och agera olika.

**Zod validerar på riktigt.** MCP-SDK:n validerar *inte* argument mot det schema
en server annonserar — det är dokumentation, inte kontroll. Därför parsas varje
anrop mot `Inputs`-schemat innan dispatch. Utan det går en påhittad `quantity`
rakt in i kundvagnen, vilket för `willys_add_to_cart` betyder riktiga varor.

## Utveckling

```bash
npm run typecheck    # tsc --noEmit
npm run mcp          # starta servern på stdio
npm run smoke        # end-to-end mot en riktig session
```

Se [CLAUDE.md](CLAUDE.md) för konventioner och [docs/](docs/) för
endpoint-kartläggning och arkiverade utforskningsskript.

## Förbehåll

Det här är ett privat verktyg som automatiserar ett konto du själv äger. Det
finns inget officiellt publikt API — endpoints är kartlagda mot produktion och
kan sluta fungera när som helst utan förvarning. `src/constants/endpoints.ts`
dokumenterar både levande och bekräftat döda rutter med datum, så att ingen
återinför en trasig sådan utan att verifiera om.

Respektera Willys användarvillkor. Kör inte servern mot konton du inte
förfogar över, och undvik anropsvolymer som liknar skrapning.

## Licens

MIT — se [LICENSE](LICENSE).
