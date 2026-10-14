# Uppsättning

Servern körs på användarens egen dator och behöver deras Willys-konto i en
`.env`-fil. Svarar ett verktyg `SETUP_REQUIRED`: ta användaren genom det här,
steg för steg, och gör allt du kan åt dem. Lämna inte över en checklista.

## Stegen

1. Kör `setup` för att se exakt vad som saknas.

2. Fråga vilken ort de bor i eller handlar i. Slå upp butiker med
   `find_stores` (med `chain: "willys"`), visa träffarna som en kort lista, låt dem välja. De
   behöver aldrig leta upp ett butiks-id själva.

3. Kör `setup_init` med det valda butiks-id:t. Den skapar `.env`, skriver
   in butiken och sätter rättigheterna till 600. Svaret innehåller sökvägen till
   filen.

4. Fråga om de någonsin loggat in på willys.se med lösenord, eller bara med
   BankID. Hoppa inte över det — se avsnittet nedan.

5. Öppna filen åt dem med `open_file` och sökvägen från steg 3. En
   chattklient gör inte filsökvägar klickbara, och `.env` är dold i Finder, så
   att bara skriva ut sökvägen lämnar dem strandsatta. Servern kör på deras
   dator och kan öppna filen — gör det.

   Be dem fylla i:

   - `WILLYS_USERNAME` — personnummer (10 eller 12 siffror) eller Willys
     Plus-nummer (16 siffror)
   - `WILLYS_PASSWORD` — lösenordet till willys.se

   Spara filen. Ingen omstart behövs — servern läser om `.env` när den ändras.

6. När de säger att de är klara: kör `setup` igen och bekräfta. Är
   användarnamnet fel format säger kontrollen exakt vad som är fel — förklara
   det vänligt och låt dem rätta.

Uppgifterna skrivs direkt i filen, av användaren. Se `read_doc("help/security.md")`
för varför.

## Har de bara använt BankID finns inget lösenord att fylla i

Det här är den vanligaste anledningen till att uppsättningen fastnar, och den
ser ut som ett tekniskt fel fast den inte är det. Servern loggar in genom att
fylla i ett formulär med användarnamn och lösenord. BankID går inte att
automatisera — det kräver signering i telefonen vid varje anrop.

Har de aldrig satt ett lösenord på willys.se har de ingenting att skriva i
filen, och de kommer leta tills de ger upp. Säg det rakt ut, innan de öppnar
filen:

> Servern kan bara logga in med lösenord, inte med BankID. Har du aldrig satt
> ett lösenord på willys.se behöver du skapa ett först — gå till
> https://www.willys.se/anvandare/inloggning och leta efter alternativet för
> glömt eller nytt lösenord. Har du inget konto alls börjar du på
> https://www.willys.se/registrera/privat/identifiera

Hittar de inget sådant alternativ: be dem kontakta Willys kundtjänst och be om
lösenordsinloggning. Hitta inte på en klickväg genom menyerna — Willys ändrar
sitt gränssnitt och en påhittad väg får dem att leta efter något som inte finns.
