# Felklasser

Varje fel bär en klass så du kan agera olika på varje. Rapportera aldrig ett
tomt resultat som ett faktum utan att kolla klassen — ett tyst noll ser likadant
ut som "hyllan är tom" fast orsaken är en annan.

| Klass | Betyder | Vad du gör |
| --- | --- | --- |
| `SETUP_REQUIRED` | Servern är inte konfigurerad på datorn. | Kör `setup`. Se `read_doc("help/setup.md")`. En människa måste redigera en fil — du kan inte fixa det åt dem. |
| `AUTH_EXPIRED` | Sessionen är död eller anonym. | Kör `login` för samma kedja igen och gör om anropet. |
| `INPUT` | Argumenten avvisades, eller kedjan saknar funktionen (t.ex. kundvagn hos Coop), eller Coop saknar butik. | Läs meddelandet: det säger vad som ska ändras eller vilka kedjor som har funktionen. |
| `NOT_FOUND` | Finns inte hos kedjan: produktkod, butiks-id från en annan kedja, eller en borttagen route. | Kontrollera koden mot samma kedja. Försök inte igen oförändrat. |
| `SHAPE` | Kedjan har ändrat ett svarsformat. | Servern ligger efter. Rapportera det i stället för att tolka svaret. |
| `UPSTREAM` | Kedjans serverfel, eller Coop avvisade sin API-nyckel två gånger. | Ett omförsök kan hjälpa. |

Endpoints är kartlagda mot produktion utan officiellt publikt API och kan sluta
fungera utan förvarning.

Ett okänt verktygsnamn från en äldre version svarar med ersättningen och
`release_notes`. Kör `release_notes({ since: "<versionen du kände till>" })`
innan du gissar.
