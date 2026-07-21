# Sök och pris

## Välj rätt verktyg

`willys_find_cheapest` när frågan gäller pris, "billigast", budget eller mängd.
`willys_search` när frågan gäller att hitta en specifik vara eller bläddra
sortiment.

Detta är den vanligaste felkällan. `willys_search` returnerar Willys
relevansordning; att sortera den listan själv rankar bara den sida du råkade
hämta. `willys_find_cheapest` sorterar på jämförpris (kr/kg, kr/l, kr/st) över
HELA träffmängden serverside och är det enda korrekta svaret på "billigast".

## willys_find_cheapest — parametrar

| Parameter | Beskrivning |
| --- | --- |
| `query` | fritext, 0–200 tecken. Får vara tom om `category` anges. |
| `category` | facettvärde, t.ex. "Kött" eller "Fågel". Filtreras serverside. |
| `onlySwedish` | endast verifierad svensk ursprungsmärkning. |
| `requireSwedishMeat` | striktare: kräver meat_from_sweden/swedish_bird. Använd för kött. |
| `excludeBrands` | lista, max 20, t.ex. ["Eldorado","Garant"]. |
| `onlyBuyable` | default true. Behåller endast köpbara varor. |
| `mustContain` | lista, max 5 ord. Produktnamnet måste innehålla samtliga. |
| `need` | behovstext, t.ex. "1.7 kg". Ger antal förpackningar och totalkostnad. |
| `limit` | 1–25, default 10. |

### Kategorier hittas, gissas inte

Kör först utan `category`. Svaret innehåller `tillgangliga_kategorier` med namn
och antal för just den frågan. Välj därifrån och kör om. Facetterna är per query
— en hårdkodad lista blir fel.

Varför det spelar roll: `q="köttfärs"` ger 37 träffar där den billigaste är en
Findus köttfärssås. Med `category="Kött"` ger samma fråga 29 träffar där den
billigaste faktiskt är köttfärs.

### mustContain skyddar mot självsäkert nonsens

Billigast-först över fritext matchar gärna något som delar ett ord och inget
annat. "torkad dragon" matchade ett torkat grisöra sålt som hundtugg, eftersom
det var billigast av allt som innehöll "torkad". Sätt `mustContain` när frågan
gäller en specifik vara.

### need ger riktig totalkostnad

Med `need="1.7 kg"` räknas antal förpackningar och total kostnad per kandidat,
och listan rangordnas om på vad behovet faktiskt kostar. Billigast per kg kan
tvinga fram en större förpackning än du behöver — svaret sätter då fältet
`notering`.

## willys_search — parametrar

| Parameter | Beskrivning |
| --- | --- |
| `query` | 1–200 tecken. |
| `page` | 0-indexerad, max 500. |
| `size` | 1–50, default 20. |
| `onlySwedish` | filtrerar på verifierad svensk märkning, inte på varumärke. |
| `onlyBuyable` | default true. |

## Kundvagn och produkter

Produktkoder har formen `101175556_ST` eller `101253220_KG` — suffixet är
säljenhet och ingår i koden. Hämta koden ur ett sökresultat; hitta aldrig på en.

`willys_add_to_cart` tar quantity 1–50. Taket är avsiktligt: kundvagnen är
riktiga pengar. Bekräfta med användaren innan du lägger i varor de inte bett om.

`willys_get_product_detail` ger näringsvärde och ingredienser. En kod som inte
finns returnerar `NOT_FOUND` (Willys svarar 400, inte 404, på den).

`willys_get_campaigns` kräver `storeId`, eller att `WILLYS_STORE_ID` är satt.
`willys_get_orders` är sidad, upp till 25 per anrop.
`willys_get_frequent_products` läser faktisk orderhistorik — ett anrop per
genomsökt order, så `scanOrders` är kapat till 30. Håll det lågt.
