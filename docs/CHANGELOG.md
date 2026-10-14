# Changelog

Alla ändringar som en användare eller en AI-klient märker står här. Formatet
följer [Keep a Changelog](https://keepachangelog.com/sv/1.1.0/) och versionerna
följer [SemVer](https://semver.org/lang/sv/).

**Till dig som är en AI som använder servern:** den här filen är källan för
`release_notes`. Anropa verktyget med `since` = den version du senast
kände till, så får du bara det som är nytt. En version med `### Brytande` betyder
att verktygsnamn, parametrar eller svarsformat du minns kan vara fel. Läs då
`### Migrering`, som visar gammalt anrop → nytt anrop.

## Regler för den som skriver här

- Varje ändring en klient märker hamnar under `[Unreleased]` i samma commit som
  ändringen.
- Rubrikerna, i den här ordningen: `### Brytande`, `### Migrering`, `### Tillagt`,
  `### Ändrat`, `### Utfasat`, `### Borttaget`, `### Fixat`, `### Säkerhet`.
  Utelämna tomma rubriker.
- **Brytande** = ett verktyg tas bort eller döps om, en parameter blir
  obligatorisk eller byter betydelse, svarsformatet ändras så att ett fält
  försvinner eller byter namn, eller ett verktyg får nya bieffekter (t.ex. rör
  kundvagnen där det inte gjorde det förut). Det kräver en ny major-version.
- En brytande version **måste** ha `### Migrering` med konkreta före/efter-anrop,
  och varje borttaget verktyg läggs i `RETIRED_TOOLS` (`src/constants/tools.ts`).
- Skriv för en läsare som bara har verktygsbeskrivningarna. Namnge verktyg och
  parametrar exakt.

## [Unreleased]

Nästa version är **2.0.0**: servern omfattar fem kedjor och verktygen har bytt
namn.

### Brytande

- **Alla verktyg har tappat prefixet `willys_`.** `willys_search` heter `search`,
  `willys_plan_status` heter `plan_status` och så vidare. Ett gammalt namn svarar
  med sin ersättning.
- **`chain` är obligatorisk** i sök, produkt, butiker, kampanjer, kundvagn,
  ordrar, `login`, `plan_status` och `plan_apply`: `willys`, `hemkop`, `coop`,
  `citygross` eller `mathem`.
- `willys_nearest_stores` och `willys_refresh_stores` är borttagna; båda ingår i
  `find_stores` (`lat`/`lng` respektive `refresh: true`).
- `willys_get_product_detail` heter `get_product`.
- Sök och priser kräver inte längre `sessionId`. Den är valfri och ger
  användarens egen butik; kundvagn, ordrar och `plan_apply` kräver den fortfarande.
- En session gäller en kedja. En Willys-session mot en annan kedja avvisas.
- `plan_add_recipe` och `plan_set_ingredient` tar inte längre `sessionId`.
- Butiksfälten heter `ecommerce` och `kind` (förut `clickAndCollect` och
  `willysHemma`).

### Migrering

Lägg till `chain: "willys"` och ta bort prefixet för samma beteende som förut.

| Förut (1.x) | Nu (2.0) |
| --- | --- |
| `willys_login({})` | `login({ chain: "willys" })` |
| `willys_search({ sessionId, query: "kaffe" })` | `search({ chain: "willys", query: "kaffe" })` |
| `willys_find_cheapest({ sessionId, query: "köttfärs", category: "Kött" })` | `find_cheapest({ chain: "willys", query: "köttfärs", category: "Kött" })` |
| `willys_get_product_detail({ sessionId, productCode })` | `get_product({ chain: "willys", productCode })` |
| `willys_find_stores({ query: "Göteborg" })` | `find_stores({ chain: "willys", query: "Göteborg" })` |
| `willys_nearest_stores({ lat, lng })` | `find_stores({ chain: "willys", lat, lng })` |
| `willys_refresh_stores({})` | `find_stores({ chain: "willys", query, refresh: true })` |
| `willys_get_store({ storeId })` | `get_store({ chain: "willys", storeId })` |
| `willys_get_campaigns({ sessionId, storeId })` | `get_campaigns({ chain: "willys", storeId })` |
| `willys_get_cart({ sessionId })` | `get_cart({ chain: "willys", sessionId })` |
| `willys_add_to_cart({ sessionId, productCode, quantity })` | `add_to_cart({ chain: "willys", sessionId, productCode, quantity })` |
| `willys_get_orders({ sessionId })` | `get_orders({ chain: "willys", sessionId })` |
| `willys_plan_add_recipe({ sessionId, plan, recipe, ingredients })` | `plan_add_recipe({ plan, recipe, ingredients })` |
| `willys_plan_status({ sessionId, plan })` | `plan_status({ chain: "willys", plan })` |
| `willys_plan_apply({ sessionId, plan, dryRun })` | `plan_apply({ chain: "willys", sessionId, plan, dryRun })` |
| `willys_read_doc`, `willys_fetch_url`, `willys_setup` … | `read_doc`, `fetch_url`, `setup` … med samma argument |

Nytt i 2.0 utan motsvarighet: `compare_prices` (samma vara i flera kedjor) och
`plan_status({ compareWith })` (samma plan prissatt i flera kedjor).

### Tillagt

- Kedjorna Hemköp, Coop, City Gross och Mathem. Coop kräver en e-handelsbutik;
  `find_stores({ chain: "coop", query: "<postnummer>" })` säger vilken.
- `compare_prices`: billigaste matchande vara per kedja i ett anrop, med vilken
  kedja som är billigast och en `avvagning` om billigast per kilo och billigast
  för behovet skiljer.
- `plan_status({ compareWith })`: vad samma plan kostar i andra kedjor.
- Hemköp-priser för en vald butik utan inloggning.

- `release_notes`: svarar med ändringarna sedan en given version.
- Serverns version läses nu från `package.json`. Den skickas i
  `initialize`-svaret (`serverInfo.version`) och i instruktionerna, så att en
  AI-klient vet vilken version den pratar med.
- Borttagna verktyg svarar med sin ersättning i stället för "Okänt verktyg"
  (`RETIRED_TOOLS`).
- Internt: en adapter per plattform (`src/chains/`). Willys och Hemköp delar en
  Axfood-adapter.

### Ändrat

- Butiksregistret hämtas om automatiskt när det är äldre än 7 dagar.
- `find_cheapest` rangordnar på jämförpris i servern i stället för att
  lita på kedjans sortering. Resultatet blir detsamma för Willys.

- `find_cheapest`: jämförpriset kontrolleras mot pris ÷ förpackning. Avviker
  uppströms värde mer än en faktor 3 används det beräknade, och varje produkt
  har `perUnitSource` (`uppstroms`, `beraknat` eller `okontrollerat`).
- `find_cheapest`: har träffarna olika jämförenheter (kr/kg och kr/l)
  rangordnas den vanligaste enheten först, och svaret säger det i `notering`.

### Fixat

- `find_stores` hittar butiker på postnummer skrivet utan mellanslag
  (`82231` matchar `822 31`).
- `find_cheapest` slängde Nötfärs, Blandfärs och Fläskfärs för
  "köttfärs" (35 av 37 träffar) eftersom namnen inte innehöll ordet. Sammansatta
  ord med samma efterled räknas nu som relaterade.
- `find_cheapest` sorterar bort djurmat när frågan inte gäller djur
  (`bortfiltrerade.petFood`).
- `find_cheapest` sorterar bort varor där frågan bara är förled i ett annat ord:
  "Köttfärssås" för "köttfärs", "Äggnudlar" för "ägg". Köttfärssås rankades
  tidigare som billigast köttfärs hos Willys och Hemköp.
- Ett behov i styck rangordnar kr/st först. Förut kunde äggnudlar (kr/kg)
  tränga undan alla ägg, och planen hos City Gross och Mathem räknades då utan
  ägg och såg billigare ut än den var.

## [1.0.0] - 2026-07-31

Första versionen. Allt före den här är oversionerat.

### Tillagt

- Session: `willys_login`, `willys_check_auth`, `willys_logout`.
- Sök och pris: `willys_search`, `willys_search_suggestions`,
  `willys_find_cheapest` (rankar på jämförpris över hela träffmängden),
  `willys_get_product_detail`, `willys_get_campaigns`.
- Kundvagn: `willys_get_cart`, `willys_add_to_cart`, `willys_remove_from_cart`.
- Ordrar och profil: `willys_get_orders`, `willys_get_order_details`,
  `willys_get_frequent_products`, `willys_get_customer_info`.
- Butiker: `willys_find_stores`, `willys_nearest_stores`, `willys_get_store`,
  `willys_refresh_stores`.
- Receptplanering: `willys_plan_add_recipe`, `willys_plan_remove_recipe`,
  `willys_plan_set_ingredient`, `willys_plan_remove_ingredient`,
  `willys_plan_status`, `willys_plan_apply`, `willys_plan_clear`.
- Hjälp och uppsättning: `willys_read_doc`, `willys_fetch_url`,
  `willys_open_file`, `willys_setup`, `willys_setup_init`.
