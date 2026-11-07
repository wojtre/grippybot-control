# Grippy Bot Control — Smart Wojtech Lab

Steruj wydrukowanym ramieniem Grippy Bot z przeglądarki: **ruchami własnej ręki przed kamerą** albo przeciągając przeguby na schemacie 2D. Panel działa na Raspberry Pi, a otwierasz go na swoim komputerze przez SSH. Rozpoznawanie dłoni działa lokalnie w przeglądarce — obraz z kamery nigdzie nie jest wysyłany.

Projekt dla osób budujących pierwszego robota. Instrukcja jest po polsku. Nie potrzebujesz aplikacji mobilnej, konta w chmurze, Node.js ani płatnego API.

![Sterowanie gestami: lewa pięść zezwala na ruch, prawe ramię prowadzi robota (tryb demo, bez kamery)](docs/gesture-demo.png)

## Co znajdziesz w repozytorium

- Sterowanie gestami z kamery komputera: lewa pięść włącza ruch, prawe ramię prowadzi przeguby, prawa dłoń otwiera i zamyka chwytak.
- Panel do sterowania przeciąganiem i kalibracji serw.
- Instrukcję instalacji na Raspberry Pi.
- Instrukcje podłączenia, połączenia przez SSH i uruchamiania panelu.
- Skill do instalacji i konfiguracji z pomocą Codex lub Claude Code.

## Instalacja z pomocą agenta

**Konfigurację oprogramowania możesz przejść z agentem w Codex lub Claude Code**, korzystając z dołączonego skilla [`grippybot-setup`](skills/grippybot-setup/SKILL.md). Agent pomoże dobrać polecenia do Twojego loginu i hosta, zainstalować kontroler, skonfigurować usługi, zestawić tunel SSH i sprawdzić działanie panelu.

Otwórz repozytorium w wybranym narzędziu i skorzystaj z [krótkiej instrukcji uruchomienia skilla](docs/agents.md). Możesz też od razu napisać:

```text
Przeczytaj skills/grippybot-setup/SKILL.md i pomóż mi zainstalować ten
kontroler na Raspberry Pi 4. Wyjaśniaj kroki dla początkującego i zaznaczaj,
które polecenia wykonujemy na komputerze, a które na Pi. Nie wykonuj ruchów robota.
```

Agent potrzebuje dostępu do terminala i Twojego Pi, aby wykonywać polecenia. Włożenie karty, podłączenie przewodów i wpisanie haseł pozostają po Twojej stronie. Jeśli wolisz instalację ręczną, postępuj według instrukcji poniżej.

## 1. Najpierw wypróbuj bez robota

Na Macu albo komputerze z Linuxem i Pythonem 3.10 lub nowszym:

```bash
git clone https://github.com/wojtre/grippybot-control.git
cd grippybot-control
python3 -m grippy_control --simulate
```

Otwórz **http://127.0.0.1:8765**. Wskaźnik `DEMO` oznacza, że nic nie jest podłączone do sprzętu. Możesz przeciągać ramię i sprawdzić checkboxy. `Ctrl+C` w terminalu zamyka demonstrację. Tryb demo nie wymaga biblioteki pigpio.

Jeżeli port jest zajęty, dodaj `--port 8766` i otwórz http://127.0.0.1:8766.

### Wypróbuj sterowanie gestami

W katalogu projektu pobierz raz modele rozpoznawania:

```bash
python3 -m grippy_control.prepare_vision
```

W działającym panelu wybierz **Gesty → Włącz kamerę**. Domyślnie:

- **Lewa ręka:** zaciśnij pięść i przytrzymaj chwilę — robot zaczyna podążać. Otwarta lewa dłoń od razu pauzuje z zachowaniem pozycji i chwytu.
- **Prawa ręka:** bark, łokieć i nadgarstek prowadzą przeguby S1–S4. Otwarta dłoń otwiera chwytak, pięść go zamyka.

Bez włączenia trybu na żywo porusza się tylko schemat. Analiza obrazu działa
lokalnie w przeglądarce. [Instrukcja, kalibracja i przygotowanie na Pi](docs/gestures.md).

![Obrazkowa instrukcja obu rąk przed uruchomieniem kamery](docs/gesture-start.png)

Zakładka **Przeciąganie** pozwala ustawić każdy przegub myszą i skalibrować serwa:

![Panel w trybie przeciągania, demo bez podłączonego robota](docs/panel-demo.png)

## 2. Co przygotować do prawdziwego robota

- Raspberry Pi 4 Model B i karta microSD. Referencyjny zestaw działa na **Raspberry Pi OS Lite, Legacy / Bookworm, 64-bit**, Python 3.11.
- Pi 400 ma ten sam obsługiwany przez instalator wariant sprzętowy; nie został przez nas sprawdzony na fizycznym robocie. **Pi 5 nie jest obsługiwane przez ten sterownik.** Nie wybieraj innego systemu wyłącznie dlatego, że jest nowszy — instrukcja instalacji jest dla Bookworm.
- Pięć pozycyjnych serw **SG90 180°**. Wersja o obrocie ciągłym 360° nie zastępuje serwa pozycyjnego.
- Wydruki i części mechaniczne Grippy Bot. [Pliki STL udostępnione przez Roboteurs](https://cults3d.com/en/3d-model/gadget/grippy-bot) pobierzesz ze strony autora mechaniki; nie są dołączone do tego repozytorium.
- Osobny, stabilizowany zasilacz **5 V do serw**. Wydajność prądową dobierz do pięciu konkretnych serw, uwzględniając prąd rozruchu i zatrzymania. Nie zasilaj silników z GPIO ani z pinu 3,3 V Pi.
- Własny zasilacz Raspberry Pi, przewody sygnałowe i solidne rozprowadzenie zasilania, np. WAGO z odpowiednimi przewodami. Płytka stykowa nie jest wymagana.

Zanim cokolwiek przepniesz, wyłącz zasilacz serw. Przy pierwszym ustawianiu środka zdejmij orczyki albo rozłącz mechanizm, aby nie wymusić kolizji. Nie przenoś cudzej kalibracji: SG90 z różnych partii mogą mieć inne granice i zachowanie.

## 3. Przygotuj Raspberry Pi — na swoim komputerze

1. Uruchom oficjalny [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. Wybierz model Pi i wskazany wyżej Raspberry Pi OS Lite Bookworm. Jeśli nie ma go w aktualnej liście, użyj oficjalnego obrazu Legacy z [archiwum Raspberry Pi](https://downloads.raspberrypi.com/raspios_lite_arm64/images/); sprawdź w nazwie/informacjach obrazu, że to Bookworm. Instalator odmówi pracy na innym wydaniu.
3. W personalizacji ustaw nazwę komputera, np. `grippybot`, oraz **własny login i hasło**. Włącz SSH. Ustaw Wi-Fi, kraj i strefę czasową lub użyj Ethernetu.
4. Zapisz system na właściwej karcie. Ta operacja wymazuje kartę. Włóż ją do Pi, podłącz zasilanie Pi i poczekaj na start sieci.

W przykładach dalej używamy loginu **`robot`** i nazwy **`grippybot.local`**. Zastąp je swoimi wartościami. Login nie musi nazywać się `pi` ani `robot`.

Otwórz Terminal na Macu/Linux albo PowerShell z OpenSSH na Windows:

```bash
ssh robot@grippybot.local
```

Przy pierwszym połączeniu SSH może zapytać o klucz hosta. Potwierdź po sprawdzeniu, że łączysz się ze swoim Pi. Podczas wpisywania hasła terminal nie pokazuje znaków — to normalne. Od tej chwili polecenia wpisujesz **na Raspberry Pi**. Jeśli `.local` nie działa, znajdź adres Pi w routerze i użyj np. `ssh robot@ADRES_IP`.

Oficjalna pomoc: [SSH i znajdowanie adresu Pi](https://www.raspberrypi.com/documentation/computers/remote-access.html).

## 4. Zainstaluj kontroler — na Raspberry Pi

Podczas instalacji zasilacz serw pozostaw odłączony. W terminalu po SSH:

```bash
sudo apt update
sudo apt install -y git
git clone https://github.com/wojtre/grippybot-control.git
cd grippybot-control
bash scripts/install-pi.sh --dry-run
```

Ostatnie polecenie tylko pokazuje plan. Możesz przeczytać [instalator](scripts/install-pi.sh). Następnie:

```bash
bash scripts/install-pi.sh
```

Instalator sam poprosi o uprawnienia `sudo` — **nie uruchamiaj całego skryptu przez sudo**. Instaluje pakiety `pigpio`, `python3-pigpio` i `python3-venv`, tworzy `.venv`, lokalny `config.json` i dwie usługi:

| Usługa | Zadanie |
| --- | --- |
| `grippy-pigpiod` | Generuje impulsy serw; dostęp wyłącznie lokalny, port 8889. |
| `grippy-panel` | Python i panel przeglądarkowy; dostęp wyłącznie lokalny, port 8765. |

Po instalacji obie startują automatycznie po włączeniu Pi. **Start systemu i otwarcie panelu nie włączają sygnałów serw.** Instalator nie rusza istniejącej kalibracji. Jeśli wykryje działający sterownik lub panel, zatrzyma się zamiast go przejmować — zobacz [rozwiązywanie problemów](docs/troubleshooting.md).

Sprawdzenie bez poruszania robotem:

```bash
systemctl is-active grippy-pigpiod grippy-panel
.venv/bin/python scripts/doctor.py
```

Obie usługi powinny pokazać `active`, a przeguby przed pierwszym włączeniem: `sygnał wyłączony`.

## 5. Połącz panel z przeglądarką — na swoim komputerze

Pozostaw sesję SSH na Pi i otwórz **drugi terminal na komputerze**, nie wewnątrz Pi. Wpisz:

```bash
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 127.0.0.1:8765:127.0.0.1:8765 robot@grippybot.local
```

To **tunel SSH**: przekazuje lokalny port komputera do lokalnego panelu na Pi. Zostaw terminal otwarty. Brak tekstu po zalogowaniu jest normalny. W przeglądarce na komputerze otwórz:

**http://127.0.0.1:8765**

Nie wpisuj adresu IP Pi z portem 8765 — panel celowo nasłuchuje wyłącznie na lokalnym interfejsie. Nie wystawiaj portów 8765 i 8889 do internetu. Jeśli korzystasz z Maca/Linux i masz to repozytorium też na komputerze, tę samą komendę uruchomisz krócej:

```bash
bash scripts/connect.sh robot@grippybot.local
```

## 6. Podłącz i uruchom serwa

Zanim włączysz tryb na żywo, sprawdź [schemat zasilania i tabelę pinów](docs/wiring.md). Domyślne sygnały:

| Przegub | GPIO BCM | Fizyczny pin Pi |
| --- | ---: | ---: |
| S1 — podstawa | 17 | 11 |
| S2 — bark | 27 | 13 |
| S3 — łokieć | 22 | 15 |
| S4 — nadgarstek | 23 | 16 |
| S5 — chwytak | 24 | 18 |
| Wspólna masa GND | — | 6 |

1. W panelu najpierw sprawdź **podgląd**, który nie wysyła ruchów.
2. Przy pierwszym uruchomieniu odznacz wszystkie przeguby oprócz jednego. Ustaw prędkość `1×`. Sprawdź osobno każde serwo, z rozłączonym mechanizmem/orczykiem.
3. **„Sterowanie na żywo” włączy zaznaczone, nieaktywne serwa na 1500 µs.** Zaznaczone serwa, które już działają, zachowają swoje zadane pozycje. To moment, w którym może wystąpić fizyczny ruch.
4. Przeciągaj punkty na ramieniu. Obrót podstawy i rozwarcie szczęk mają osobne widoki poniżej.
5. Odznaczenie checkboxa wyłącza sygnał danego przegubu. Ramię może wtedy opaść. Wyłączenie samego trybu na żywo wraca do podglądu, **pozostawiając ostatnie zadanie i sygnały aktywne**.
6. **STOP / Escape wyłącza sygnały wszystkich serw. To nie jest odłączenie zasilania ani sprzętowy wyłącznik awaryjny.** Podeprzyj ramię. Zamknięcie strony lub zerwanie SSH nie zatrzymuje automatycznie robota: dokończy ostatnie zadanie i będzie utrzymywał pozycję.

Prędkości `8×` i `16×` zwiększają tempo zadawania pozycji, nie gwarantują takiego mnożnika rzeczywistej prędkości. Najpierw usuń drgania i kolizje; szybkie ruchy nie są ich naprawą.

**Kalibracja i dopasowanie schematu:** [instrukcja obsługi](docs/usage.md).

## 7. Jak uruchamiać następnym razem

1. Włącz Pi i poczekaj na sieć. Usługi wystartują same.
2. Na komputerze uruchom tunel z punktu 5 i otwórz panel. Nie uruchamiaj drugiego tunelu, jeśli pierwszy nadal działa.
3. Sprawdź mechanikę i zasilanie, a dopiero potem włącz sterowanie na żywo.

Gdy usług nie ma w stanie `active`, na Pi:

```bash
sudo systemctl start grippy-pigpiod grippy-panel
journalctl -u grippy-panel -n 40 --no-pager
```

Po zakończeniu podeprzyj ramię, kliknij STOP, wyłącz zasilacz serw i zamknij system Pi:

```bash
sudo shutdown -h now
```

Poczekaj na zakończenie zamykania, zanim odłączysz Pi od prądu. Samo zamknięcie terminala SSH nie wyłącza Raspberry Pi.

## Co znajduje się w repozytorium

- [`grippy_control/controller.py`](grippy_control/controller.py): wysyłanie impulsów, ruch i kalibracja.
- [`grippy_control/server.py`](grippy_control/server.py): lokalny serwer HTTP.
- [`grippy_control/panel.html`](grippy_control/panel.html): cała wizualizacja SVG i obsługa przeglądarki, bez zewnętrznych bibliotek.
- [`config.example.json`](config.example.json): nazwy i piny, które możesz skopiować do `config.json`.
- [`scripts/`](scripts/): instalacja, usługi, połączenie SSH i diagnostyka.
- [`docs/development.md`](docs/development.md): testy, API, aktualizacja i szczegóły działania.
- [`skills/grippybot-setup/`](skills/grippybot-setup/): skill pomagający w instalacji i diagnostyce w Codex lub Claude Code. [Jak go użyć](docs/agents.md).

## Zanim opublikujesz własną konfigurację

`config.json`, `data/`, hasła, klucze SSH i logi nie są potrzebne do uruchomienia u innych osób. Nie dodawaj ich do Git. Fabryczny roboczy zakres to **1400–1600 µs**, bez twierdzenia, że jest mechanicznie bezpieczny w każdym złożonym ramieniu. Kalibrację robisz dla własnych serw i montażu.

## Status, autorzy i licencja

Panel powstał w Smart Wojtech Lab z pomocą Codex i Claude Code. Sterowanie fizycznego prototypu sprawdzono na Pi 4 / Bookworm. Publiczna wersja uogólnia ścieżki, konfigurację i instalację; testy automatyczne działają na symulowanych serwach. Nie przeprowadzono jeszcze instalacji na czystej karcie SD przez niezależnego widza.

Kod tego repozytorium: [MIT](LICENSE). Mechanika Grippy Bot jest projektem [Roboteurs](https://cults3d.com/en/3d-model/gadget/grippy-bot). Biblioteka [pigpio](https://github.com/joan2937/pigpio) jest niezależną zależnością. Licencja tego panelu nie zmienia licencji cudzych modeli, zdjęć ani kodu.
