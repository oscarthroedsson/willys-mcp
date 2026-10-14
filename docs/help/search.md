# Sök och pris

## Kedjor

Varje sök- och prisverktyg tar `chain`: `willys`, `hemkop`, `coop`, `citygross`
eller `mathem`. **Fråga användaren vilken kedja som gäller om det inte framgått.**
Välj aldrig åt dem. Vill de jämföra: `compare_prices`.

| Kedja | Butik | Anteckning |
| --- | --- | --- |
| `willys` | valfri | Samma pris i hela landet. Inloggning ger kundvagn och ordrar. |
| `hemkop` | valfri | Priser per butik; utan butik gäller Hemköps standardbutik. |
| `coop` | **krävs** | Bara e-handelsbutiker har sortiment och priserna skiljer. Fråga efter postnummer och kör `find_stores({ chain: "coop", query: "<postnummer>" })`; svaret säger vilken butik som levererar dit. |
| `citygross` | valfri | Butik smalnar av sortimentet. |
| `mathem` | finns inte | En nationell prislista. Inga sökförslag, inga kategorier. |

ICA stöds inte: deras API stryper efter ungefär fem anrop per fem minuter.

## Välj rätt verktyg

- `find_cheapest` för pris, "billigast", budget eller mängd i EN kedja.
- `compare_prices` för samma vara i FLERA kedjor i ett anrop.
- `search` för att hitta en specifik vara eller bläddra sortiment.

Detta är den vanligaste felkällan. `search` returnerar kedjans relevansordning;
att sortera den listan själv rankar bara den sida du råkade hämta.
`find_cheapest` hämtar hela träffmängden och **servern** rangordnar på jämförpris
(kr/kg, kr/l, kr/st). Kedjornas egna sorteringar litar den inte på: bara Axfood
sorterar rätt, City Gross ignorerar kampanjpris och Mathem kan inte sortera.

## find_cheapest — parametrar

| Parameter | Beskrivning |
| --- | --- |
| `chain` | obligatorisk. |
| `query` | fritext, 0–200 tecken. Får vara tom om `category` anges. |
| `storeId` | butik från `find_stores`, samma kedja. Krävs för Coop. |
| `category` | kategori från `tillgangliga_kategorier` i ett tidigare svar för samma kedja. Namnen skiljer mellan kedjor ("Kött" hos Willys, "Kött, Fågel & Chark" hos Coop). |
| `onlySwedish` | endast verifierad svensk ursprungsmärkning. |
| `requireSwedishMeat` | striktare: kräver märkning för svenskt kött eller svensk fågel. Använd för kött. |
| `excludeBrands` | lista, max 20, t.ex. ["Eldorado","Garant"]. |
| `onlyBuyable` | default true. |
| `mustContain` | lista, max 5 ord. Produktnamnet måste innehålla samtliga. |
| `mustNotContain` | lista, max 20 ord att utesluta. |
| `need` | behovstext, t.ex. "1.7 kg". Ger antal förpackningar och totalkostnad. |
| `limit` | 1–25, default 10. |

### Vad servern redan skyddar mot

- **Djurmat** sorteras bort när frågan inte gäller djur (`bortfiltrerade.petFood`).
  Coop rankade annars kattmat först på "köttfärs".
- **Fel jämförpris uppströms**: jämförpriset kontrolleras mot pris ÷ förpackning.
  Avviker det mer än en faktor 3 används det beräknade. Varje produkt har
  `perUnitSource`: `uppstroms`, `beraknat` eller `okontrollerat`.
- **Blandade enheter**: kr/kg och kr/st är inte jämförbara. Den vanligaste
  enheten rangordnas först och svaret säger det i `notering`.
- **Sammansatta ord**: "köttfärs" räknar Nötfärs och Blandfärs som relaterade
  (samma efterled), men inte tamponger för "mineralvatten".

### Kategorier hittas, gissas inte

Kör först utan `category`. Svaret innehåller `tillgangliga_kategorier` för just
den frågan och kedjan. Välj därifrån och kör om. Finns kategorin inte för
frågan sätter svaret `varning` och kategorin ignoreras — Hemköp saknar ofta
kategorifacetten helt.

### mustContain skyddar mot självsäkert nonsens

Billigast-först över fritext matchar gärna något som delar ett ord och inget
annat. "torkad dragon" matchade ett torkat grisöra sålt som hundtugg. Sätt
`mustContain` när frågan gäller en specifik vara.

### need ger riktig totalkostnad

Med `need="1.7 kg"` räknas antal förpackningar och total kostnad per kandidat,
och listan rangordnas om på vad behovet faktiskt kostar. Svaret sätter då
`notering` om billigast per kg kräver en större förpackning.

## compare_prices — parametrar

| Parameter | Beskrivning |
| --- | --- |
| `query` | varan. |
| `chains` | 1–5 kedjor. Fråga användaren vilka. |
| `stores` | butik per kedja, t.ex. `{ "coop": "252500" }`. Coop kräver en. |
| `mustContain`, `mustNotContain`, `onlySwedish`, `requireSwedishMeat`, `excludeBrands`, `need` | som i `find_cheapest`. |
| `perChain` | 1–3 produkter per kedja i svaret, default 2. |

Svaret har `billigast` (kedja och jämförpris), en rad per kedja, och
`avvagning` om billigast per kilo och billigast för `need` är olika kedjor —
fråga då användaren, välj inte åt dem. En kedja som felar har `fel` med
felklass; övriga svarar ändå.

## search — parametrar

| Parameter | Beskrivning |
| --- | --- |
| `chain` | obligatorisk. |
| `query` | 1–200 tecken. |
| `storeId` | som ovan. |
| `sessionId` | valfri: med en inloggad Willys-session gäller användarens butik. |
| `page` | 0-indexerad, max 500. |
| `size` | 1–50, default 20. |
| `onlySwedish` | filtrerar på verifierad svensk märkning, inte på varumärke. |
| `onlyBuyable` | default true. |

## Produktkoder

Koden måste komma från samma kedja. Hitta aldrig på en.

| Kedja | Format |
| --- | --- |
| Willys, Hemköp, City Gross | `101175556_ST` — suffixet är säljenhet. Samma kod är samma vara i alla tre. |
| Coop | EAN, 8–14 siffror |
| Mathem | ett tal, t.ex. `67701` |

`get_product` ger näringsvärde och ingredienser. En kod som inte finns ger
`NOT_FOUND`.

## Kundvagn, ordrar, kampanjer

Kundvagn och ordrar finns bara för Willys än (kräver `login`). Andra kedjor
svarar med vilka kedjor som stöder det.

`add_to_cart` tar quantity 1–50. Taket är avsiktligt: kundvagnen är riktiga
pengar. Bekräfta med användaren innan du lägger i varor de inte bett om.

`get_campaigns` tar `storeId`; för Willys tas `WILLYS_STORE_ID` ur .env om det
utelämnas. `get_orders` är sidad, upp till 25 per anrop.
`get_frequent_products` läser faktisk orderhistorik — ett anrop per genomsökt
order, så `scanOrders` är kapat till 30. Håll det lågt.
