# Arkiverade skript

Engångsutredningar som har besvarat sin fråga. Svaren är inbakade i
`src/auth/login.ts`, `src/constants/` och `src/upstream/schemas.ts` — skripten
ligger kvar för att visa *hur* svaret togs fram, inte för att köras igen.

De är undantagna från `tsconfig.json` och har därför inaktuella importsökvägar
(`../src/...` pekar fel härifrån). Ska något av dem återupplivas: flytta tillbaka
till `scripts/` och rätta sökvägarna till `../src/...`.

## Inloggningsforensik

Fem skript som kartlade varför Willys inloggningsformulär inte gick att driva
över vanlig HTTP. Resultatet blev Puppeteer-flödet i `src/auth/login.ts` och
selektorerna i `src/constants/selectors.ts`.

| Skript | Frågan det besvarade |
| --- | --- |
| `dom-dump.ts` | Hur ser formuläret faktiskt ut? |
| `capture-auth.ts` | Vilken endpoint tar emot inloggningen? |
| `click-compare.ts` | Avgör klickmetoden om formuläret skickas? |
| `hydration-test.ts` | Får React de inskrivna värdena, och spelar väntetiden roll? |
| `cookie-bisect.ts` | Vilka cookies kräver en autentiserad endpoint egentligen? |

Slutsatsen var att formuläret kräver en riktig webbläsare. Om Willys gör om
inloggningen är det här startpunkten för att kartlägga den på nytt.

## Svars- och formatkartläggning

| Skript | Frågan det besvarade |
| --- | --- |
| `shape-probe.ts` | Vilka svarsformat har de endpoints som återstod att porta? Blev `src/upstream/schemas.ts`. |
| `volume-survey.ts` | Hur ser `displayVolume` och `comparePrice` ut i verkligheten? Formaten den hittade ligger nu som testdata i `tests/volume.test.ts`. |
| `cheapest-demo.ts` | Demonstration av rankningslagret mot produktion. Ersatt av `tests/category.test.ts`, som testar samma fälla utan att kräva session. |
