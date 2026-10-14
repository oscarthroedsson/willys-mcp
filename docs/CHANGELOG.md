# Changelog

Alla ändringar som en användare eller en AI-klient märker står här. Formatet
följer [Keep a Changelog](https://keepachangelog.com/sv/1.1.0/) och versionerna
följer [SemVer](https://semver.org/lang/sv/).

**Till dig som är en AI som använder servern:** den här filen är källan för
`willys_release_notes`. Anropa verktyget med `since` = den version du senast
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

### Tillagt

- `willys_release_notes`: svarar med ändringarna sedan en given version.
- Serverns version läses nu från `package.json`. Den skickas i
  `initialize`-svaret (`serverInfo.version`) och i instruktionerna, så att en
  AI-klient vet vilken version den pratar med.
- Borttagna verktyg svarar med sin ersättning i stället för "Okänt verktyg"
  (`RETIRED_TOOLS`).
- Internt: en adapter per kedja (`src/chains/`). Willys och Hemköp delar en
  Axfood-adapter. Hemköp är inte nåbart via verktygen än; det kommer med
  `chain`-parametern.

### Ändrat

- `willys_find_stores`, `willys_nearest_stores` och `willys_get_store` svarar
  med fälten `ecommerce` och `kind` i stället för `clickAndCollect` och
  `willysHemma`. Butiksregistret hämtas om automatiskt när det är äldre än
  7 dagar.
- `willys_find_cheapest` rangordnar på jämförpris i servern i stället för att
  lita på Willys sortering. Resultatet blir detsamma för Willys.

### Fixat

- `willys_find_stores` hittar butiker på postnummer skrivet utan mellanslag
  (`82231` matchar `822 31`).

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
