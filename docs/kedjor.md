# Kedjor — publika API:er

Kartlagt 2026-10-13 i webbläsare och med curl, **utan inloggning**. Statuskoder
är observerade. Allt som kräver konto (kundvagn med inloggning, ordrar, kundprofil)
är inte kartlagt än. Willys egen yta står i [`endpoints.md`](endpoints.md).

## Arkitekturbeslut

Beslutat 2026-10-13. Verktygen är generiska med en `chain`-parameter
(`search({ chain: "coop", query })`). Under dem finns en adapter per **plattform**,
inte per butik (`src/upstream/axfood/`, `coop/`, `ica/` …). Alla adaptrar
implementerar samma interface.

Varför inte ett verktyg per kedja (`coop_search`, `ica_search` …):

- Verktygsytan skulle femdubblas (cirka 150 verktyg), och varje beskrivning kostar
  kontext hos modellen.
- Prisjämförelse mellan kedjor ska servern göra med normaliserat jämförpris.
  Modellen ska inte behöva sy ihop tre anrop.

Varför plattform och inte butik: Willys och Hemköp är samma Axfood-API med olika
bas-URL, och Coop och City Gross söker båda via Loop54.

Varje adapter deklarerar vilka **capabilities** den har. Saknas en funktion svarar
verktyget med en tydlig felklass i stället för att anropet går sönder. `chain` är
obligatoriskt i sök och kundvagn, så att servern aldrig väljer butik åt
användaren.

| Plattform | Kedjor | Sökmotor | Nyckel | Pris per butik |
| --- | --- | --- | --- | --- |
| Axfood (SAP Hybris) | Willys, Hemköp | Solr | Ingen | Ja |
| Coop (Hybris + Loop54) | Coop, Stora Coop, X:-tra | Loop54 | Publik APIM-nyckel i HTML | Ja, per e-handelsbutik |
| Ocado | ~~ICA~~ — bortvald | Ocado | Ingen, men AWS WAF | Ja |
| City Gross | City Gross | Loop54 | Ingen | Sortiment per butik |
| Mathem | Mathem | Egen | Ingen | Nej (ej verifierat per region) |

**ICA implementeras inte** (beslut 2026-10-13). AWS WAF tillåter ungefär 5 anrop
per 5 minuter, vilket är för lite för att planera en korg. Kartläggningen nedan
finns kvar för att ingen ska behöva göra om den.

Lidl har ingen e-handel för mat i Sverige. Det finns bara veckoblad, så Lidl är
inte kartlagt.

## Gemensamma fallgropar

- **Sponsrade träffar blandas in.** ICA lägger annonser i en egen grupp
  (`type: "featured"`, `featuredProductCampaign`). De ska filtreras bort, annars
  hamnar en betald placering först i "billigast".
- **Djurmat matchar på köttord.** "köttfärs" ger kattmat och hundmat hos Coop. Det
  är samma nonsensproblem som `mustContain` redan löser för Willys, och det gäller
  alla kedjor.
- **Uppströms jämförpris kan vara fel.** Coop rankade "Nötfärs 12%" för 199 kr
  först med jämförpris 0,20 kr/kg. En rimlighetskontroll mot `pris / mängd`
  behövs innan något kallas billigast.
- **Bara Axfood sorterar korrekt på jämförpris.** ICA sorterar inom kluster,
  City Gross ignorerar kampanjpris och Mathem saknar sortering. Servern måste
  sortera själv efter normalisering.

---

## Hemköp — Axfood

Bas: `https://www.hemkop.se`. **Willys hela publika yta fungerar oförändrad.**
Svarens nycklar är identiska, bara priserna skiljer sig (samma mjölk:
16,90 kr på Willys, 17,45 kr på Hemköp). Adaptern är Willys-adaptern med en
annan `BASE`.

Verifierat 200 på båda: `/search`, `/search/autocomplete/SearchBox`,
`/axfood/rest/p/{code}`, `/axfood/rest/store/active`, `/leftMenu/categorytree`,
`/axfood/rest/csrf-token`, `/axfood/rest/cart` (anonym), `/axfood/rest/customer`
(anonym).

Det som skiljer:

| Rutt | Anteckning |
| --- | --- |
| `/axfood/rest/store?online=false&clickAndCollect=false&b2bClickAndCollect=false` | **Hela butikslistan**, 206 för Hemköp och 259 för Willys. Bättre än geosöket. |
| `/axfood/rest/search/store?q=&lat=…&lng=…` | Willys-varianten ger `results: null` på Hemköp. Använd listan ovan. |
| `/search/campaigns/online?q={storeId}` | Fungerar, men butiks-id:t måste finnas i Hemköps register (t.ex. `4798`). |
| `/search/campaigns/offline?q={storeId}` | Butikens fysiska erbjudanden. |
| `/search/multisearchComplete?q=&page=&size=` | Det sidan själv anropar; samma kuvert som `/search`. |

Öppen fråga: hur sätts butik för en anonym session? Troligen
`POST /axfood/rest/cart/store?storeId=`. Det är inte testat eftersom det är en
skrivning.

---

## Coop

Två API:er bakom Azure APIM. Nycklarna står **publikt i sidans HTML**
(`coopSettings`: `personalizationApiSubscriptionKey`,
`hybrisApiSubscriptionKey`, `storeApiSubscriptionKey`). De skickas som
`Ocp-Apim-Subscription-Key`.

**Hämtas lat, hårdkodas aldrig.** Strategin:

1. Första Coop-anropet: finns ingen nyckel i minnet, gör en vanlig `fetch` mot
   `https://www.coop.se/`. Ingen webbläsare behövs. Verifierat: en ren curl utan
   ens User-Agent ger 200, och alla tre nycklarna står i HTML:en.
2. Plocka ut nycklarna med regex: `"personalizationApiSubscriptionKey":"([0-9a-f]{32})"`.
3. Cacha i minnet.
4. Svarar Coop 401 eller 403: kasta nyckeln, hämta om en gång och gör om
   anropet. Det hanterar att Coop roterar nyckeln.

### Sök — `https://external.api.coop.se/personalization`

Alla anrop: `?api-version=v2&store={ledger}&groups=CUSTOMER_PRIVATE&device=desktop&direct=false`.
Nyckel: `personalizationApiSubscriptionKey`.

| Rutt | Metod | Body |
| --- | --- | --- |
| `/search/products` | POST | `{"query":"…","resultsOptions":{"skip":0,"take":48,"sortBy":[],"facets":[]}}` |
| `/search/entities/by-id` | POST | `["7300156581006"]` (EAN) |
| `/search/auto-complete` | POST | `{"query":"mjöl"}` |
| `/search/products/promotions` | POST | Samma `resultsOptions` som sök; 1085 erbjudanden |

Sortering, ur frontendens egen mappning:

```json
{"order":"asc","attributeName":"comparativeSortPrice","type":"attribute"}
```

Andra nycklar: `piecePrice` (förpackningspris) och
`lowestOnlineSinglePiecePrice` (pris med kampanj).

Facetter (`resultsOptions.facets`): `{"attributeName":"topCategory","type":"distinct","operator":"OR","selected":[]}`.
Andra attribut är `manufacturerName`, `filterLabels` och `categoryIds`. Ett tomt
`facets: []` ger inga facetter tillbaka.

Sökträffarna innehåller redan ingredienser (`listOfIngredients`), näringsvärden
(`nutrientInformation`), jämförpris (`comparativePriceData.b2cPrice`) och enhet.
En separat produktdetalj behövs sällan.

### Butiker

| Rutt | Nyckel | Anteckning |
| --- | --- | --- |
| `GET https://proxy.api.coop.se/external/store/stores?api-version=v2` | `storeApiSubscriptionKey` | 787 butiker: `storeId`, `ledgerAccountNumber`, `conceptName` |
| `GET …/external/store/stores/{ledger}?api-version=v2` | samma | Adress, lat/lng, öppettider. Kräver 6-siffrigt **ledger**, inte `storeId` |
| `GET https://external.api.coop.se/ecommerce/coop/coopstore?postCode=41301&fields=BASIC&api-version=v1` | `hybrisApiSubscriptionKey` | **Postnummer → e-handelsbutik** (`252500` Stora Coop Bäckebol) |

**Fallgrop:** sök med en vanlig butiks ledger ger 0 träffar. Bara e-handelsbutiker
har sortiment, så rätt väg är postnummer → `coopstore` → `store=`. Priserna
skiljer sig mellan e-handelsbutiker (Mellanmjölk: 10,95 kr i Uppsala, 15,95 kr i
Göteborg).

---

## ICA — Ocado-plattformen (bortvald, implementeras inte)

Två värdar:

- `https://handla.ica.se/api/store/v1?zip=41301&customerType=B2C` →
  butiker för ett postnummer (`forHomeDelivery`, `forPickupDelivery`). Ger
  `accountId` (t.ex. `1004219`), som är id:t i alla övriga rutter.
- `https://handlaprivatkund.ica.se/stores/{accountId}/api/...`

| Rutt | Metod | Anteckning |
| --- | --- | --- |
| `webproductpagews/v6/product-pages/search?q=&maxPageSize=300&maxProductsToDecorate=300&tag=web&sortOptionId=pricePerAscending` | GET | Sök. v4/v5 ger 404 |
| `webproductpagews/v5/products/bop?retailerProductId={id}` | GET | Produktdetalj: ingredienser och näringsvärden i `bopData.fields` |
| `webproductpagews/v6/product-pages/promotions?maxPageSize=&maxProductsToDecorate=&tag=web` | GET | Butikens erbjudanden |
| `search/v1/suggestions/refined?searchTerm=&limit=&regionId={uuid}` | GET | Autocomplete. `regionId` krävs (400 utan) |
| `webproductpagews/v6/products` | PUT | Dekorera id-lista. Kräver session/CSRF (403 anonymt) |

Sorteringsvärden: `favorite`, `pricePerAscending`, `pricePerDescending`,
`priceAscending`, `priceDescending`. Parametern heter **`sortOptionId`**.
`sortBy` ignoreras tyst.

Pris: `price.amount` och `unitPrice.price.amount` + `unitPrice.unitName`
(`PER_1KG`, `PER_LITRE`). Beloppen är strängar.

**Fallgrop 1, kluster:** träffarna kommer i `productGroups[]` med
`type: "cluster"`, en grupp per kategori (nötfärs, blandfärs, köttbullar …).
Sorteringen gäller bara inom varje kluster och är inte ens strikt där
(kycklingfärs: 94 kr/kg före 81 kr/kg). Platta ut alla grupper och sortera själv.

**Fallgrop 2, annonser:** `type: "featured"` är betalda placeringar.

**Fallgrop 3, botskydd:** API:t ligger bakom **AWS WAF**. Efter ungefär 10
curl-anrop i följd svarar det `202` med tom body och
`x-amzn-waf-action: challenge`. Utmaningen kräver JavaScript.

Uppmätt 2026-10-13 med anrop utan cookies:

| Takt | Resultat |
| --- | --- |
| Snabbt i följd | Blockerad efter cirka 7 anrop |
| Ett var 20:e s | 5 × 200, det 6:e blockeras (efter 101 s) |
| Nedkylning | Släpper efter cirka 5 min |

Budgeten är alltså ungefär **5 anrop per 5-minutersfönster och IP**, oavsett takt.
Adaptern ska därför ha en anropsbudget, cache för sökresultat (butikspriser
ändras sällan) och backoff på `x-amzn-waf-action`. Den ska aldrig försöka igen
direkt.

Priserna skiljer sig per butik (samma mjölk: 16,50 kr på Maxi Göteborg,
17,85 kr på ICA Karlaplan).

---

## City Gross

Bas: `https://www.citygross.se/api/v1`. Ingen nyckel.

| Rutt | Anteckning |
| --- | --- |
| `Loop54/search?SearchQuery=&skip=&take=&store=&SortField=&SortOrder=` | Sök; svaret har `searchResults.products`, `facets`, `totalCount` |
| `Loop54/search/quick/?SearchQuery=` | Autocomplete |
| `Loop54/products/{id}/related`, `…/recommended`, `Loop54/products/topsellers` | Rekommendationer |
| `sites?siteTypeId=3` | Butiker; `storeNumber` (t.ex. `3204`) är värdet för `store=` |

`SortField`: `p_comparison_price`, `p_price`, `p_name`, `p_brand`,
`p_bfcategorycode`; `SortOrder=asc|desc`. `store` filtrerar sortimentet
(108 → 101 träffar för köttfärs).

Pris ligger i `productStoreDetails.prices.currentPrice` (`price`,
`comparativePrice`, `comparativePriceUnit`: `KGM`). Kampanj ligger i
`activePromotion.priceDetails`.

**Fallgrop:** jämförprissorteringen räknar med ordinarie pris. Blandfärs med
kampanj 99,95 kr/kg sorteras som 123 kr/kg.

Produktkoderna har Axfood-format (`101408266_KG`). Det är värt att undersöka om
de matchar Willys koder, eftersom det skulle ge exakt varumatchning mellan
kedjorna.

---

## Mathem

Bas: `https://www.mathem.se/api/v1`. Ingen nyckel.

| Rutt | Anteckning |
| --- | --- |
| `search/mixed/?q=&type=product&page=` | Sök; 30 per sida, `attributes.has_more_items` |
| `products/{id}/` | Produktdetalj (`detailed_info`, `categories`, `promotions`) |

Pris: `attributes.gross_price` och `gross_unit_price` +
`unit_price_quantity_abbreviation`. Beloppen är strängar. Ingen sortering
hittades i sök, så servern sorterar själv. Filtrering sker via
`filters=dietary_preferences:halal_suitable`; giltiga värden kommer tillbaka i
`filters[]`.

---

## Öppet

1. Allt inloggat: kundvagn, ordrar, profil per kedja.
2. Hur Hemköp sätter butik för en anonym session.
3. Om Mathems priser skiljer sig per region.
