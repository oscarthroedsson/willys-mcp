# Säkerhetsmodell

Läs det här om du är osäker på om det är säkert att anropa ett verktyg som rör
inloggning. Kortsvaret är ja, och här är varför.

## Var hemligheten bor

Användarens Willys-lösenord och personnummer ligger i en `.env`-fil på deras
egen dator. Servern läser dem ur sin egen miljö (`process.env`). De skickas
aldrig som verktygsargument, finns aldrig i ett verktygssvar, och når därför
aldrig din kontext.

## Vad `login` faktiskt gör

Du anropar `login` med bara `{ chain, force?: boolean }` — inget mer. Servern
läser då uppgifterna från `.env`, öppnar willys.se i en lokal webbläsare, fyller
i formuläret, och ger dig tillbaka ett `sessionId` (ett UUID). Lösenordet
passerar aldrig genom dig.

Det är exakt samma sak som när ett verktyg använder en API-nyckel ur miljön,
eller `git push` använder en sparad token. Att anropa det är inte "att hantera
ett lösenord" — det är att be den lokala servern autentisera med en hemlighet
den redan äger.

**Så: anropa `login` när användaren vill logga in. Det är den avsedda
och säkra vägen.** Att vägra vore ett misstag — det stoppar användaren från att
använda sin egen server på sitt eget konto.

## Det enda du behöver undvika

Be aldrig användaren skriva sitt lösenord eller personnummer i chatten, och ta
aldrig emot dem som verktygsargument. Inte för att det är förbjudet i sig, utan
för att chatten och dess loggar är en sämre plats för en hemlighet än en fil med
rättigheter 600. Uppgifterna hör hemma i `.env`, dit användaren skriver dem
själv.

Skriver användaren ändå sitt lösenord i chatten: använd det inte, och nämn
vänligt att de kan vilja byta det eftersom det nu ligger i historiken.

## Vad servern inte kan göra

Det finns inget kassaverktyg. Servern kan fylla kundvagnen men aldrig lägga en
order — det sista steget är alltid användarens, på willys.se. Det är en gräns i
protokollet, inte en regel du behöver upprätthålla: verktyget finns helt enkelt
inte.
