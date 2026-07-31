# Installation

Servern körs lokalt på din egen dator och pratar med Willys som dig. Den är
inte en molntjänst — ingen annan ser dina uppgifter, och den fungerar bara så
länge din dator är igång.

## Krav

- **Node.js 20 eller senare.** Kolla med `node --version`. Saknas det:
  [nodejs.org](https://nodejs.org) → ladda ner LTS.
- **Ett Willys-konto med lösenord.** BankID fungerar inte — kontot måste ha ett
  vanligt lösenord. Har du bara loggat in med BankID: gå till willys.se och
  sätt ett lösenord först.
- **Cirka 400 MB ledigt.** Inloggningen kräver en riktig webbläsare, så
  installationen laddar ner en egen Chromium.

## Steg 1 — hämta och bygg

Har du fått en `.bundle`-fil, packa upp den till ett riktigt projekt:

```bash
git clone ~/Downloads/willys-mcp.bundle willys-mcp
```

Sedan, i projektmappen:

```bash
cd willys-mcp
npm install
npm run build
```

`npm install` tar några minuter, mest för webbläsaren. `npm run build` är inte
valfritt — `dist/` följer inte med, den skapas här.

Notera sökvägen till mappen, den behövs i steg 2:

```bash
pwd
```

## Steg 2 — koppla in i din Claude

Servern fungerar i **Claude Desktop** (app för Mac och Windows) och i
**Claude Code**. Den fungerar *inte* i claude.ai i webbläsaren — en webbsida
kan inte starta program på din dator.

### Claude Desktop

Öppna inställningarna → Developer → Edit Config. Då öppnas
`claude_desktop_config.json`. Lägg in:

```json
{
  "mcpServers": {
    "willys": {
      "command": "node",
      "args": ["/HELA/SÖKVÄGEN/från/pwd/dist/index.js"],
      "env": { "WILLYS_HOME": "/Users/DITTNAMN/.willys-mcp" }
    }
  }
}
```

Sökvägen måste vara absolut. Hittar inte Claude Desktop `node` — appen startas
inte från ett terminalfönster och ärver därför inte alltid din PATH — byt ut
`"node"` mot den fullständiga sökvägen från `which node`.

`WILLYS_HOME` är valfritt men rekommenderat: utan den hamnar dina uppgifter i
projektmappen, och en framtida version som ersätter mappen tar dem med sig.

Filen ligger på:
- macOS `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows `%APPDATA%\Claude\claude_desktop_config.json`

Starta om Claude Desktop. Servern dyker upp under verktygsikonen.

### Claude Code

```bash
claude mcp add willys --env WILLYS_HOME=$HOME/.willys-mcp -- node /HELA/SÖKVÄGEN/dist/index.js
```

### Uppdatera senare

Har du klonat: `git pull` i projektmappen, sedan `npm run build`. Fick du en ny
`.bundle`-fil: `git pull ~/Downloads/willys-mcp.bundle` och bygg om.

## Steg 3 — låt Claude sätta upp resten

Du behöver **inte** redigera några filer själv först. Öppna en chatt och skriv:

> Hjälp mig komma igång med Willys

Claude kör uppsättningen, frågar vilken ort du handlar i, slår upp din butik och
skapar konfigurationsfilen `.env` åt dig — och öppnar den, så du slipper leta
efter en dold fil. Det enda du gör själv är att fylla i två rader:

```
WILLYS_USERNAME=      # personnummer (10 eller 12 siffror) eller
                      # Willys Plus-nummer (16 siffror)
WILLYS_PASSWORD=      # ditt lösenord till willys.se
```

Spara filen, starta om Claude, och säg till — Claude verifierar att det
fungerar.

**Skriv aldrig lösenordet i chatten.** Det ska bara stå i filen. Claude är
instruerad att aldrig fråga efter det, och att be dig byta lösenord om du råkar
klistra in det ändå.

## Vad du kan göra sen

> Här är tre recept för veckan — lägg ingredienserna i min kundvagn

Claude slår ihop mängderna över recepten, väljer förpackningsstorlek på vad som
faktiskt blir billigast, och visar en lista med totalsumma *innan* något läggs i
vagnen. Lägger du till fler recept räknas korgen om — behöver du plötsligt 13
ägg i stället för 6 byts 6-packet mot ett större.

Servern har inget kassaverktyg. Den kan fylla kundvagnen men aldrig lägga en
order — det gör du själv på willys.se.

## Om något går fel

Be Claude köra `willys_setup`. Den kontrollerar sex saker och säger exakt vad
som saknas och vad du ska göra åt det.

Vanligast:

| Symptom | Orsak |
| --- | --- |
| "Servern är inte konfigurerad" | `.env` saknar användarnamn eller lösenord |
| Inloggningen misslyckas direkt | Kontot har bara BankID, inget lösenord |
| "måste vara personnummer" | E-postadress fungerar inte som användarnamn |
| Servern syns inte i Claude | Fel sökväg i konfigen, eller inte omstartad |

Sessioner lever 24 timmar och återanvänds. Du loggar alltså inte in vid varje
fråga — Willys stryper upprepade inloggningar, så det är med flit.
