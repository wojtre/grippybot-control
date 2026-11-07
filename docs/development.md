# Dla rozwijających projekt

## Architektura

```text
Przeglądarka (HTML / CSS / JavaScript / SVG)
      │ HTTP przez tunel SSH
      ▼
Python ThreadingHTTPServer :8765 — tylko 127.0.0.1
      │ Controller: cele, limity, interpolacja, STOP
      ▼
pigpio Python → lokalny pigpiod :8889
      │ impulsy serw, typowo 50 Hz
      ▼
GPIO → przewody sygnałowe SG90
```

Biblioteka `pigpio` i demon `pigpiod` generują powtarzane impulsy. `Controller._send()` wywołuje gotową metodę `set_servo_pulsewidth(gpio, microseconds)`. Wartość `0` wyłącza impulsy. Nie ustawiamy procentowej mocy silnika: serwo interpretuje szerokość impulsu jako pozycję i samo steruje wewnętrznym silnikiem. [Źródło i dokumentacja pigpio](https://github.com/joan2937/pigpio/blob/v79/pigpio.py#L1570-L1594).

Pętla ruchu zmienia zadane pozycje mniej więcej co 20 ms. To odrębna sprawa od dokładnego generowania impulsów przez demona. W trybie live przechowujemy ostatnie cele zamiast kolejki dawnych żądań. Kierunek, kąty i długości na schemacie są poglądowe, nie stanowią dokładnego modelu kinematycznego.

## Układ plików i konfiguracja

- `config.example.json`: publiczny wzorzec nazw i GPIO.
- `config.json`: własna konfiguracja, pomijana przez Git. Bez `--config` używana jest domyślna mapa z `config.py`.
- `data/ranges.json`: własna kalibracja. Tworzy się po zapisie MIN/MAX. Brak pliku oznacza robocze 1400–1600 µs z flagami `min_saved=false`, `max_saved=false`.
- `data-sim/`: osobne dane demonstracji.
- `data/.controller.lock`: blokada drugiego procesu korzystającego z tego samego katalogu. Nie zastępuje zakazu uruchamiania innego oprogramowania na tych samych GPIO.

```bash
python3 -m grippy_control --help
python3 -m grippy_control --config config.example.json --check-config
python3 -m grippy_control --simulate --port 8766 --data-dir data-sim
```

`--check-config` waliduje konfigurację i ewentualny plik zakresów bez łączenia się z GPIO i bez uruchamiania serwera. Start serwera nie wysyła PWM i odmówi przejęcia aktywnych wyjść. Program sprzętowy wymaga lokalnego demona na porcie 8889; inny port można wskazać przez `--pigpio-port` w uruchomieniu ręcznym. Instalator ma stałe, udokumentowane porty 8889/8765.

## Testy bez robota

Z katalogu repozytorium:

```bash
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
python3 -m compileall -q grippy_control scripts
bash -n scripts/install-pi.sh scripts/connect.sh
bash scripts/install-pi.sh --dry-run
```

Nie wymagają `pigpio`, połączenia SSH ani GPIO. Testy używają symulowanego sterownika. CI uruchamia je na Linuxie; nie świadczy to o pomiarze rzeczywistych impulsów ani mechanicznym bezpieczeństwie ramienia.

Node.js jest potrzebny wyłącznie do testów czystej geometrii i maszyny stanów
gestów. Uruchamianie panelu, przygotowanie modeli i instalacja na Pi nadal
nie wymagają Node.js ani npm.

Opcjonalny test całego interfejsu `tests/browser-smoke.mjs` używa Playwright,
sztucznej kamery i wyników rozpoznawania. Sprawdza przepływ UI → API →
symulowane serwa, nie jakość modelu na prawdziwych dłoniach. Odmawia ruchów,
jeśli serwer nie zgłasza `simulation=true`. W osobnym terminalu uruchom
`python3 -m grippy_control --simulate --port 18766 --data-dir "$(mktemp -d)"`, a następnie na komputerze:

```bash
npm install --prefix /tmp/grippy-browser-test playwright
/tmp/grippy-browser-test/node_modules/.bin/playwright install chromium
GRIPPY_PLAYWRIGHT=/tmp/grippy-browser-test/node_modules/playwright/index.mjs node tests/browser-smoke.mjs
```

Możesz wskazać istniejącą przeglądarkę zmienną `GRIPPY_CHROME` oraz inny adres
symulacji przez `GRIPPY_TEST_URL`. Test nie wymaga modeli ani dostępu do
prawdziwej kamery. Rzeczywiste modele trzeba dodatkowo sprawdzić lokalnie
w zakładce Gesty po przygotowaniu zasobów.

Demo udostępniane użytkownikowi korzysta z trwałego `data-sim`, żeby zachować
jego MIN/MAX. Testy przeglądarkowe uruchamiaj na oddzielnym porcie i z pustym
katalogiem tymczasowym; nie zastępuj nimi działającego demo. Pliki osobistej
kalibracji pozostają pomijane przez Git.

Pakiet można też zainstalować w swoim środowisku Pythona przez `python3 -m pip install .`. Tryb sprzętowy potrzebuje systemowego pigpiod i klienta pigpio; instalator Pi udostępnia klienta przez `--system-site-packages`. `pip install '.[pi]'` instaluje sam klient, nie demona.

## API

`GET /api/state` jest tylko odczytem. `GET /` zwraca stronę zawierającą losowy token bieżącego procesu. `POST /api/command` wymaga nagłówka `X-Control-Token`. Token chroni żądania przeglądarkowe; nie jest kontem użytkownika ani uwierzytelnianiem do publicznego internetu. Serwer nasłuchuje wyłącznie na loopback. Nie dodawaj publicznego `--host 0.0.0.0` jako obejścia SSH.

| `action` | Dodatkowe pola | Znaczenie |
| --- | --- | --- |
| `speed` | `value`: 125, 250, 500, 1000, 2000 albo 4000 | Tempo µs/s; samo nie wysyła impulsów. |
| `enable` | `ids`: lista S1–S5 | Włączenie na 1500 µs, aktywne wyjścia wracają płynnie do 1500. UI wywołuje je tylko dla wyłączonych. |
| `disable` | `ids` | Wyłączenie wskazanych sygnałów; trwa także po kolejnych iteracjach bieżącego ruchu. |
| `follow` | `targets`: obiekt ID → impuls | Nadpisanie ostatnich celów w granicach kalibracji. |
| `move` | `ids`, `targets` | Wspólny ruch aktywnych przegubów do granic kalibracji. |
| `step` | `ids`: jeden przegub, `delta`: −100 lub 100 | Krok kalibracji, może wyjść poza dotychczasowy zakres, technicznie 500–2500 µs. |
| `save` | `ids`: jeden przegub, `edge`: `min` lub `max` | Zapis ostatniego zadanego impulsu jako granicy. |
| `stop` | brak | Przerwanie pracy i wyłączenie sygnałów. |
| `gesture_start` | `ids`, `epoch`, `frame`, `age_ms` | Wyłącznie dla jawnie włączonych osi. Zakłada sesję bez zmiany impulsów; zwraca jej ID w `gesture.session`. |
| `gesture_follow` | `session`, `seq`, `frame`, `age_ms`, `targets` | Nowa klatka, rosnące `seq` i `frame`, komplet celów osi sesji; przedłuża limit 400 ms. |
| `gesture_pause` / `gesture_end` | `session` | Unieważnia pasującą sesję, usuwa cele i podtrzymuje ostatnie wysłane impulsy. |

`GET /api/vision` sprawdza obecność i rozmiar lokalnych modeli bez GPIO.
`/static/` udostępnia wyłącznie pliki wewnątrz katalogu zasobów, w tym JS,
CSS, WASM i modele. `python3 -m grippy_control.prepare_vision` pobiera pliki
z manifestu `vision-assets.json`, sprawdza SHA-256 i zapisuje je atomowo.

Stan zawiera `gesture: {session, epoch, reason, timeout_ms}`. `epoch` chroni
przed opóźnionym rozpoczęciem sesji po pauzie/STOP. `frame` to monotoniczny czas
przechwycenia klatki w przeglądarce; serwer porównuje kolejność w obrębie sesji,
a nie zegar przeglądarki z zegarem Pi. `age_ms` musi być w zakresie 0–250;
limit po stronie Pi jest liczony zegarem monotonicznym od odbioru, pomniejszony
o ten wiek. Nie jest to pomiar czasu transmisji ani synchronizacja zegarów.
Duplikaty klatek nie odświeżają sesji. Błędna aktualizacja pasującej sesji ją
pauzuje; wiadomości starszej sesji nie przejmą nowej. Podczas sesji gestów
zwykłe ruchy/kalibracja nie mogą przejąć kontrolera; `disable` pauzuje sesję,
a STOP unieważnia sesję i wyłącza sygnały. Nie zmienia to zachowania ręcznego
`follow`, które nadal utrzymuje ostatni cel po utracie połączenia.

W przeglądarce czysta geometria i maszyna stanów są oddzielone od kamery
i transportu. Klasyczny Web Worker ładuje moduł MediaPipe dynamicznie: runtime
0.10.21 wymaga `importScripts`, niedostępnego we workerze typu `module`.
Worker przetwarza jedną pełną klatkę naraz; UI oraz transport nie kolejkowują
starych klatek. Obsługiwany jest GPU z próbą przejścia na CPU przy błędzie
inicjalizacji. Role dłoni przypisuje odległość od nadgarstków pozy, niezależnie
od kolejności wyników. Odbicie lustrzane dotyczy wyłącznie wyświetlania.

Frontend zachowuje intencję zezwolenia przez maksymalnie 1500 ms niepewnego
śledzenia. W tym czasie od razu wysyła `gesture_pause`, nie wysyła starych
celów ani sztucznych klatek. Po odzyskaniu pewnej pięści i kompletnego
śledzenia zaczyna nową sesję od aktualnych impulsów i pozycji ręki. Otwarta
dłoń, blur, ukrycie karty, kamera off, błędy połączenia i STOP kasują intencję.
Limit 400 ms na Pi pozostaje niezależny i nie został wydłużony.

Odczyt stanu rozpoczęty przed poleceniem lub podczas polecenia nie może
nadpisać jego nowszego potwierdzenia. Frontend oznacza żądania rewizją, aby
opóźniony polling przez SSH nie kończył nowej sesji pozornym starym stanem.

Wartości `pulse` i `get_servo_pulsewidth()` to ostatnie zadania, nie zmierzone kąty. Po zerwaniu połączenia nie ma automatycznego odcięcia mocy; nie opisuj STOP jako certyfikowanego zatrzymania awaryjnego.

## Aktualizacja istniejącej instalacji

Nie aktualizuj ani nie restartuj programu, kiedy serwa podtrzymują niepodparte ramię. Najpierw podeprzyj je, STOP, odłącz zasilacz serw. Na Pi:

```bash
cd ~/grippybot-control
sudo systemctl stop grippy-panel grippy-pigpiod
```

Zrób własną kopię `config.json` oraz `data/ranges.json`, jeśli istnieje. Następnie:

```bash
git pull --ff-only
bash scripts/install-pi.sh
```

Instalator zachowa oba pliki i odtworzy usługi dla bieżącego użytkownika/katalogu. Jeśli były to starsze, ręcznie skonfigurowane usługi o innych nazwach, najpierw sprawdź [diagnostykę](troubleshooting.md).

## Wyłączenie automatycznego startu

Po zabezpieczeniu i wyłączeniu robota:

```bash
sudo systemctl disable --now grippy-panel grippy-pigpiod
```

To wyłącza usługi tego projektu; nie usuwa repozytorium, pakietów ani kalibracji. Samo wyłączenie `grippy-panel` powoduje próbę wyłączenia obsługiwanych sygnałów w trakcie poprawnego zamknięcia procesu. Awaria systemu nie zapewnia takiego zachowania.
