# Willys endpoints

Kartlagt mot produktion 2026-07-18 med en autentiserad session. Statuskoder är
observerade, inte antagna. Sanningskällan i kod är
[`src/constants/endpoints.ts`](../src/constants/endpoints.ts) — den här filen
förklarar *varför*.

Bas: `https://www.willys.se`

## Autentisering

Inloggningen går inte att göra över HTTP. Formuläret på `/anvandare/inloggning`
kräver en riktig webbläsare, så `auth/login.ts` kör Puppeteer, skördar cookies
och lagrar dem i SQLite med 24 timmars TTL.

Användarnamnet är personnummer (10 eller 12 siffror) eller Willys Plus-nummer
(16 siffror). 10 siffror fungerar i produktion trots att formulärets egen
felmeddelandetext ber om `ååååmmddxxxx`. En e-postadress skickas aldrig in av
formuläret och ger ett missvisande 401 längre ner i kedjan.

Muterande anrop kräver en CSRF-token från `/axfood/rest/csrf-token` som skickas
med per anrop.

| Rutt | Metod | Anteckning |
| --- | --- | --- |
| `/anvandare/inloggning` | GET | Inloggningssida, drivs av Puppeteer |
| `/axfood/rest/csrf-token` | GET | Krävs före varje POST |
| `/axfood/rest/customer` | GET | Kundprofil; används även som sessionskontroll |

## Sök

| Rutt | Metod | Anteckning |
| --- | --- | --- |
| `/search` | GET | Fritextsök, facetter och sortering |
| `/search/autocomplete/SearchBox` | GET | Sökförslag, parameter `term` |
| `/search/campaigns/online` | GET | Kampanjer, `q` är butiks-id |
| `/c/{slug}` | GET | Kategoribläddring — ignorerar `sort`, undvik |

### Parametrar på `/search`

| Parameter | Värde | Anteckning |
| --- | --- | --- |
| `q` | söksträng, ev. med facett | Se facettsyntaxen nedan |
| `page` | 0-indexerad | |
| `size` | 1–100 | Willys tvingar tak 100 oavsett vad du ber om |
| `sort` | `compareprice:asc` m.fl. | Utelämnad = relevans |

### Facettsyntax

Willys kör SAP Hybris. Solr-lagret kodar in facettfilter *inuti* `q`, inte som en
egen parameter:

```
q=köttfärs                 → 37 träffar, billigast är en Findus-sås
q=köttfärs:category:Kött   → 29 träffar, billigast är faktisk köttfärs
```

Formen är `söktext:facettnyckel:facettvärde`. Giltiga värden kommer tillbaka i
`facets[]` i svaret, så de behöver aldrig gissas — och ska inte hårdkodas, för
de är per query.

### Sorteringsfällan

`sort=price:asc` sorterar på förpackningspris och rankar en portionsrätt på 16 kr
(75 kr/kg) över ett kilo köttfärs på 69 kr. `sort=compareprice:asc` sorterar på
jämförpris över hela träffmängden och är det enda korrekta för "billigast".

## Produkt

| Rutt | Metod | Anteckning |
| --- | --- | --- |
| `/axfood/rest/p/{code}` | GET | 90 fält inkl. ingredienser och näringsvärde |
| `/axfood/rest/products` | GET | "Andra köpte också" |

Produktkoder har formen `101175556_ST` eller `101253220_KG` — suffixet är
säljenheten.

Två fält är lätta att välja fel:

- Näringsvärden ligger i `nutritionsFactList` (med s). `nutritionFacts` är tom
  sträng på varje produkt som inspekterats.
- En kod som inte finns ger **400**, inte 404. Klienten översätter det till
  `NOT_FOUND` så att det inte läser som ett avbrott.

## Kundvagn

| Rutt | Metod | Anteckning |
| --- | --- | --- |
| `/axfood/rest/cart` | GET | Innehåll, summa, rabatt |
| `/axfood/rest/cart/addProducts` | POST | Både lägga till och ta bort |

Det finns ingen delete-endpoint. Borttagning är en add med `quantity: 0`.

## Order

| Rutt | Metod | Anteckning |
| --- | --- | --- |
| `/axfood/rest/account/orders` | GET | Opaginerad — se nedan |
| `/axfood/rest/orderdata?q={id}` | GET | Varurader, grupperade per kategori |

Orderlistan är opaginerad: 69 ordrar kom tillbaka som 45 KB i ett svar. Klienten
skivar i minnet så att modellens kontext inte sväljer alltihop.

"Mina vanligaste varor" härleds ur orderhistoriken, inte ur CMS-sidan
`pageLabelOrId=minavanligastevaror` — den returnerar ett 22 KB sidskal utan en
enda produktkod.

## Butiker

Butiksregistret (254 butiker) hämtas i sin helhet och cachas i SQLite. Sökning,
närmaste-butik och detaljer går mot cachen och kräver ingen session — registret
är publikt.

## Döda endpoints

Bekräftat döda 2026-07-18, alla svarar 404 med en 80 KB HTML-kropp. De ligger
kvar i `DEAD_ENDPOINTS` i stället för att raderas, så att ingen återinför dem
utan att verifiera om.

| Rutt | Ersättare |
| --- | --- |
| `/axfood/rest/tms/delivery-slots` | ingen känd |
| `/axfood/rest/pickup-slots` | ingen känd |
| `/_next/data/{buildId}/sv/erbjudanden.json` | `/search/campaigns/online` |

Erbjudanderutten är den lärorika: den bäddade in en Next.js build-hash
(`a4eecdbf`, sedan roterad till `e5bbbc04`) och tappade dessutom sitt
`/sv`-prefix. **Varje endpoint som innehåller ett build-id är en tidsinställd
bomb.** Använd `/axfood/rest/`-rutterna.
