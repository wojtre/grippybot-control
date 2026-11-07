# Sterowanie gestami

Zakładka **Gesty** korzysta z kamery komputera, na którym otwierasz panel.
MediaPipe analizuje obraz lokalnie w osobnym wątku przeglądarki. Na Raspberry Pi
trafiają wyłącznie cele serw. Kamera nie wymaga konta, płatnego API ani OpenCV.
Zacznij w aktualnym Chrome na Macu lub komputerze z Linuxem; inne przeglądarki
mogą mieć różną obsługę kamery, WebAssembly i OffscreenCanvas.

## Przygotuj modele raz

Na komputerze, **jeśli uruchamiasz lokalną symulację**, w katalogu projektu:

```bash
python3 -m grippy_control.prepare_vision
python3 -m grippy_control --simulate
```

Otwórz **http://127.0.0.1:8765**, wybierz **Gesty**, a następnie **Włącz kamerę**.
Zezwól przeglądarce na dostęp do kamery. Domyślnie sterujesz tylko schematem.

**Jeśli panel działa na Pi**, modele przygotuj na Pi, w katalogu projektu:

```bash
.venv/bin/python -m grippy_control.prepare_vision
```

Na komputerze otwórz panel przez dotychczasowy tunel SSH opisany w README.
Przeglądarka pobierze modele z Pi przez ten tunel i wykona analizę na komputerze.
Nie trzeba podłączać kamery do Pi ani restartować usług dla samego pobrania modeli.
Aktualizację kodu istniejącej instalacji wykonuj zgodnie z `development.md`.

Przygotowanie pobiera około 34 MB plików z jsDelivr i Google oraz informacje
licencyjne. Wersja MediaPipe jest przypięta do **0.10.21**, modele do wersji **1**,
a pobrania są sprawdzane sumami SHA-256. Po przygotowaniu internet nie jest
potrzebny. Błąd pobrania nie zastąpi poprawnego pliku; ponowne uruchomienie
polecenia uzupełni brakujące lub uszkodzone pliki. Pliki pozostają lokalne i są
pomijane przez Git; nowy checkout wymaga przygotowania modeli.

## Ustaw kadr

- Jedna osoba, widoczne oba barki, łokieć ręki sterującej i obie dłonie.
- Ramię sterujące ustaw dość bokiem do kamery, żeby było widać jego zgięcie.
- Nie krzyżuj dłoni ani nie zasłaniaj ich robotem. Przy niepewnym przypisaniu
  aplikacja pauzuje zamiast wybierać inną rękę.
- „Lustro” zmienia tylko obraz. Lewa i prawa ręka oznaczają Twoje ręce;
  sterowanie nie zmienia się po wyłączeniu lustra.
- Na podglądzie przy każdym nadgarstku widać rolę dłoni, np. „LEWA · ZEZWOLENIE”.
  Jeśli napis jest przy złej ręce, kamera sama odbija obraz (np. opcja lustra
  w aplikacji kamery Insta360). Wyłącz odbicie w aplikacji kamery albo zaznacz
  „Kamera odbija obraz — zamień lewą i prawą rękę” w „Kamera i podgląd”.

Pozycje nadgarstków do obliczania ruchu pochodzą z modelu dłoni. Model
sylwetki nadal musi pewnie wykrywać oba barki i łokieć sterujący oraz wskazywać
nadgarstki blisko wykrytych dłoni, żeby przypisanie lewej/prawej było jednoznaczne.
Sama niska ocena widoczności nadgarstka w modelu sylwetki nie blokuje już
poprawnie śledzonej dłoni.

## Dwie ręce, pięć osi

Domyślnie prawa ręka steruje, lewa zezwala na ruch. Role możesz zamienić
w „Dopasuj sterowanie i skalibruj ruchy”.

| Ruch | Działanie |
| --- | --- |
| Zaciśnij lewą dłoń w pięść i przytrzymaj ok. 0,3 s | Rozpoczęcie sterowania |
| Otwórz lewą dłoń | Natychmiastowa pauza z zachowaniem położenia i chwytu |
| Dłoń chwilowo zniknie lub model zgubi gest | Zamrożenie pozycji, do 1,5 s na odzyskanie śledzenia |
| Przesuwaj prawy nadgarstek w bok względem barków | Podstawa S1 |
| Unoś / opuszczaj prawe ramię | Bark S2 |
| Zginaj prawy łokieć | Łokieć S3 |
| Zginaj prawą dłoń względem przedramienia | Nadgarstek S4 |
| Zaciśnij / otwórz prawą dłoń przy aktywnym zezwoleniu | Chwytak S5 zamyka się przy pięści, otwiera przy otwartej dłoni |

Start sterowania wymaga około 300 ms trzymania pięści, zmiana chwytaka około 200 ms.
Nie trzeba wcześniej otwierać dłoni.
Krótkie przerwy nie kasują od razu gotowości ani zezwolenia. Podczas niepewnego
śledzenia aplikacja od razu usuwa cel ruchu i trzyma ostatnią wysłaną pozycję.
Jeśli poprawne śledzenie obu dłoni i pewna pięść wrócą przed upływem **1,5 s**,
aplikacja od razu zaczyna nową sesję bez skoku.
Po dłuższym zaniku trzymana pięść znowu włącza sterowanie po około 300 ms,
liczonych od nowa, z nowym punktem odniesienia (bez skoku).
Jeśli Pi odrzuci start (np. brak połączenia), otwórz lewą dłoń raz,
zanim spróbujesz ponownie — to blokuje pętlę błędnych poleceń.

Po rozpoznaniu pięści w trybie na żywo na chwilę pojawia się **GOTOWE**, potem **AKTYWNE**.
Krótkie nierozpoznane ułożenie palców podczas zamykania nie kasuje startu.
Rozpoznana otwarta dłoń, STOP, ukrycie karty, utrata fokusu lub wyłączenie
kamery kończą zezwolenie od razu, bez okresu tolerancji.

Rozpoznana pięść zmienia kolor punktów i linii na fioletowy oraz dostaje
otoczkę. Limonkowa otoczka z napisem **STEROWANIE** pojawia się tylko na dłoni
zezwalającej, gdy sesja sterowania jest faktycznie aktywna. W samym podglądzie
otoczka pozostaje fioletowa i pokazuje **PODGLĄD**. Otwarcie dłoni lub utrata
śledzenia usuwa oznaczenie aktywnego sterowania. W okresie tolerancji pojawia
się bursztynowa otoczka **TRZYMAM** i komunikat **TRZYMAM POZYCJĘ** z czasem
pozostałym na odzyskanie śledzenia. Przy brakującej dłoni jej ostatni rysunek
jest przygaszony i zamrożony. Nie oznacza nowego pomiaru ani ruchu robota.

Punkty dłoni i sylwetki mają filtr wygładzający około 110 ms, a ruchy osi —
około 160 ms i niewielką martwą strefę. Surowe klatki nadal służą do oceny
widoczności i świeżości, więc wygładzanie nie ukrywa utraty śledzenia.

Każde wznowienie zaczyna się od bieżącej pozycji ręki i ostatnich zadanych
pozycji robota. Dzięki temu zmiana pozy podczas pauzy nie powoduje przeskoku.
Chwytak przy wznowieniu zachowuje zadanie; zareaguje dopiero na **kolejną
zmianę gestu** prawej dłoni. Możesz więc pauzować, trzymając przedmiot.

To odwzorowanie ruchów na pięć osi, a nie dokładne kopiowanie anatomii 3D.
Nadgarstek robota ma jedną oś zginania; obrót przedramienia nie ma osobnego serwa.

## Dopasuj czułość bez poruszania serwami

Wyłącz tryb na żywo. Włącz kamerę, pokaż otwartą dłoń zezwalającą i kliknij
**Kalibruj wygodny zakres · 6 s**. W tym czasie poruszaj ręką, łokciem
i nadgarstkiem w wygodnym zakresie. Osie, dla których zabrakło wyraźnego ruchu,
zachowają poprzednie ustawienia. Utrata śledzenia przerywa kalibrację.

Kierunek i czułość każdej osi możesz też zmienić osobno. Ustawienia zapisują się
w tej przeglądarce, osobno dla prawej i lewej ręki. Nie zmieniają rysunku ani
pliku `data/ranges.json`. Kierunek chwytaka zależy od montażu serwa: sprawdź go
osobno. Ograniczenia serw i wybrana prędkość nadal obowiązują.

## Tryb na żywo, pauza i STOP

Kamera, podgląd i kalibracja gestów **nie włączają serw**. Dopiero jawne
włączenie „Sterowania na żywo” aktywuje zaznaczone przeguby; nieaktywne ustawia
na 1500 µs zgodnie z dotychczasowym działaniem panelu. Najpierw sprawdź kierunki
pojedynczo i przy małej prędkości.

Przełączanie między przeciąganiem i gestami zachowuje świadomie włączony tryb
na żywo, ale resetuje zezwolenie dłoni: otwórz ją i ponownie zaciśnij pięść.
Zmiana zakładki sama nie wysyła nowej pozycji. Jeśli tryb na żywo jest wyłączony,
kamera nadal rozpoznaje gesty, a komunikat wskazuje, że sterujesz tylko podglądem.

W trybie gestów pauza usuwa cel i przerywa jego wykonywanie na ostatnim
wysłanym impulsie. Sygnały pozostają aktywne, więc robot próbuje utrzymywać
pozycję i chwyt. To nie jest pomiar rzeczywistego położenia ani gwarancja
utrzymania ciężaru przez serwa.

Jeśli Pi nie otrzyma nowej poprawnej klatki sterującej przez **400 ms**, sam
pauzuje sesję. Stare klatki ani spóźnione żądania nie wznowią wygasłej sesji.
Ukrycie karty, utrata fokusu okna, wyłączenie kamery lub przejście do
przeciągania także kończy bieżące sterowanie gestami.

**STOP / Escape** nadal wyłącza impulsy wszystkich serw. Ramię może opaść;
podeprzyj je. STOP nie odłącza zasilacza. Do wznowienia trzeba ponownie jawnie
włączyć tryb na żywo oraz otworzyć i zacisnąć dłoń zezwalającą.

## Widok do nagrania

Obraz kamery zajmuje niemal całe okno. Mały neonowy schemat zadań robota jest
nałożony w prawym dolnym rogu; nie ma osobnego panelu po prawej stronie.
Jasna linia pokazuje cel, przygaszona — ostatnio wysłane pozycje.

Przed włączeniem kamery ekran pokazuje animowaną instrukcję obu rąk.
Duży przycisk na środku uruchamia kamerę; podczas oczekiwania na zgodę
zmienia się w **Anuluj**. Po uruchomieniu na dole pojawia się **Wyłącz kamerę**.
Przycisk **⛶** włącza pełny ekran,
chowając dolne ustawienia. STOP pozostaje widoczny również przy przewijaniu.

Opcje kamery, lustra i śladu ruchu są w rozwijanej sekcji **Kamera i podgląd**.
Kalibracja gestów oraz **Przeguby i kalibracja serw** są domyślnie zwinięte
pod obrazem. Ciemna, neonowa paleta obejmuje też widok przeciągania.
Nie ma osobnego układu 9:16 ani wbudowanego nagrywania.

## Gdy coś nie działa

- **Brak modeli:** uruchom polecenie przygotowania tam, gdzie działa serwer panelu.
- **Brak dostępu do kamery:** sprawdź zgodę w przeglądarce oraz dostęp do kamery
  w ustawieniach systemu. Używaj adresu lokalnego przez tunel SSH.
- **Utrata śledzenia:** popraw światło i kadr, rozsuń dłonie, pokaż łokieć.
  Komunikat wskazuje konkretny bark lub łokieć. Powód przerwania jest zachowany
  także po powrocie śledzenia, do ponownego otwarcia dłoni zezwalającej.
- **Za duże opóźnienie:** zamknij programy obciążające komputer; aplikacja
  odrzuca klatki starsze niż 250 ms zamiast wysyłać opóźnione ruchy.
- **Robot nie reaguje:** sprawdź tryb na żywo, zaznaczone przeguby i wykonaj
  sekwencję otwarta dłoń → pięść ręką zezwalającą.

Sekcja **Diagnostyka gestów** pod kamerą pokazuje rozpoznany gest i jego
pewność dla obu rąk, stan gotowości, sesję robota oraz ostatnie osiem
komunikatów. Historia pozostaje widoczna po wyłączeniu kamery, do odświeżenia
strony. Działa tylko w pamięci tej karty; nie zapisuje ani nie wysyła obrazu.

Wskaźniki opóźnienia pokazują czas analizy i wymiany HTTP. Nie mierzą czasu
reakcji fizycznego serwa. Schemat i wartości µs przedstawiają zadania, nie
odczyty czujników.

## Płynność nadgarstka i chwytaka

- Kąty przechodzą przez filtr One Euro: przy spokojnej ręce mocno wygładza
  drgania kamery, przy szybkim ruchu prawie nie dodaje opóźnienia.
- Zmiany celu mniejsze niż 6 µs są pomijane, żeby serwo nie „polowało”
  w kółko wokół jednej pozycji.
- Kąt nadgarstka S4 liczony jest z obrazu 2D. Gdy dłoń kierujesz w stronę
  kamery albo od niej, jej rzut się skraca i kąt przestaje być wiarygodny —
  wtedy S4 zostaje w miejscu. Diagnostyka pokazuje to jako
  „Nadgarstek S4: wstrzymany”. Trzymaj dłoń mniej więcej w płaszczyźnie obrazu.
- Chwytak korzysta z gestu rozpoznanego przez model, a gdy model nie jest
  pewny (np. dłoń ustawiona bokiem), z pomiaru zgięcia palców. Gest musi
  utrzymać się około 200 ms. Jeśli chwytak działa odwrotnie, zmień kierunek
  S5 w „Dopasuj sterowanie i skalibruj ruchy”.

