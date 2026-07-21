# Felklasser

Varje fel bär en klass så du kan agera olika på varje. Rapportera aldrig ett
tomt resultat som ett faktum utan att kolla klassen — ett tyst noll ser likadant
ut som "hyllan är tom" fast orsaken är en annan.

| Klass | Betyder | Vad du gör |
| --- | --- | --- |
| `SETUP_REQUIRED` | Servern är inte konfigurerad på datorn. | Kör `willys_setup`. Se `willys_help("setup")`. En människa måste redigera en fil — du kan inte fixa det åt dem. |
| `AUTH_EXPIRED` | Sessionen är död eller anonym. | Kör `willys_login` igen och gör om anropet. |
| `INPUT` | Argumenten avvisades av schemat. | Läs meddelandet och rätta anropet. |
| `NOT_FOUND` | Resursen finns inte. | Kontrollera koden. Försök inte igen oförändrat. |
| `SHAPE` | Willys har ändrat ett svarsformat. | Servern ligger efter. Rapportera det i stället för att tolka svaret. |
| `UPSTREAM` | Willys serverfel eller nätverksfel. | Ett omförsök kan hjälpa. |

Endpoints är kartlagda mot produktion utan officiellt publikt API och kan sluta
fungera utan förvarning.
