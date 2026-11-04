# Panel i kalibracja

## Co pokazuje wizualizacja

Schemat SVG pokazuje pozycję podglądu. Jasny obrys odpowiada ostatnim wysłanym pozycjom. SG90 nie przekazuje nam fizycznego kąta: gdy zablokujesz ramię ręką, program nie wie, że nie osiągnęło celu. Dla wyłączonych, nieznanych pozycji schemat przyjmuje nominalne 1500 µs.

Przeciągaj odcinki S2–S4, punkt obrotu podstawy lub dolną szczękę. Dotknięcie przegubu wybiera go do kalibracji. Strzałki klawiatury na uchwycie zmieniają podgląd o 25 µs; przyciski kalibracji są osobne i mają krok 100 µs.

- **Podgląd:** rysunek się zmienia, ale ruch nie jest wysyłany.
- **Sterowanie na żywo:** zaznaczone, nieaktywne serwa włączają się na 1500 µs. Zaznaczone i już aktywne nie wracają na środek. Przeciąganie wysyła nowe cele.
- **Checkbox przy przegubie:** odznaczenie wyłącza ten sygnał natychmiast; inne przeguby działają dalej. Ponowne zaznaczenie podczas sterowania na żywo ustawia ten przegub na 1500 µs. W podglądzie zaznaczenie tylko przygotowuje go do następnego włączenia.
- **Wyłączenie trybu na żywo:** zatrzymuje wysyłanie nowych celów. Nie kasuje już przyjętego celu i nie wyłącza sygnałów.
- **Wykonaj pozycję podglądu:** wysyła pozę do zaznaczonych, już aktywnych serw.
- **STOP / Escape:** przerywa ruch i wyłącza sygnały. Podeprzyj ramię — może opaść.

Zamknięcie strony, utrata fokusu, uśpienie laptopa czy zerwanie tunelu nie odłączają zasilania i nie gwarantują zatrzymania robota. Nie zostawiaj ruchu bez nadzoru. Nie uruchamiaj jednocześnie drugiego programu ani drugiej przeglądarki sterującej tymi samymi serwami.

## Prędkość

| Ustawienie | Tempo zmiany zadanego impulsu |
| --- | ---: |
| 0,5× | 125 µs/s |
| 1× | 250 µs/s |
| 2× | 500 µs/s |
| 4× | 1000 µs/s |
| 8× | 2000 µs/s |
| 16× | 4000 µs/s |

Program aktualizuje zadanie w przybliżeniu co 20 ms. Prędkość działa również w kalibracji i może być zmieniona w trakcie ruchu. To ograniczenie programowe tempa zmian, nie pomiar prędkości serwa. Nowa komenda na żywo zastępuje stary cel, zamiast dodawać kolejne ruchy do kolejki. Po restarcie serwera ustawienie wraca do 1×.

## Pierwsze ustawienie środka

Najpierw wypróbuj pojedyncze serwo z orczykiem zdjętym albo z rozłączoną mechaniką. Wyłącz zaznaczenie pozostałych, ustaw 1×, włącz tryb na żywo. Dopiero po zatrzymaniu w nominalnym środku zamocuj orczyk według instrukcji mechaniki. Nie wpychaj ramienia w pozycję siłą. Nie obracaj zasilanego serwa ręką.

## Kalibracja MIN / MAX

1. Wybierz jeden przegub. Podeprzyj mechanizm, zapewnij miejsce i dostęp do odłączenia zasilania serw.
2. Włącz wyłącznie ten przegub przez tryb na żywo, a następnie wyłącz tryb na żywo. Sygnał zostaje aktywny, więc możesz używać przycisków kalibracji.
3. Przyciskami **−100 / +100 µs** sprawdzaj zakres. Każde kliknięcie naprawdę porusza serwem, także poza dotychczasowym MIN/MAX. Poczekaj na koniec każdego ruchu.
4. Nie dochodź do oporu ani zablokowania zębatek. Ograniczenie mechaniczne złożonego robota może pojawić się wcześniej niż granica samego serwa. Zostaw zapas od zauważonego ograniczenia.
5. Kliknij **Zapisz MIN** lub **Zapisz MAX**. Zapisywana jest ostatnia wysłana pozycja wybranego serwa — nie kursor w podglądzie. MIN musi być ≤1500, MAX ≥1500, a MIN < MAX. Wersja ta zakłada środek 1500 µs; nietypowe serwa wymagają zmiany kodu.
6. Powtórz dla drugiej strony i kolejnych przegubów. Robot nie ma wykrywania kolizji, więc poprawne osobne zakresy nie gwarantują bezpieczeństwa każdej kombinacji ustawień.

`MIN roboczy` i `MAX roboczy` oznaczają niepotwierdzone, startowe granice. Startowy zakres 1400–1600 µs nie jest certyfikatem bezpieczeństwa. Techniczne granice programu 500–2500 µs też nie określają mechanicznych możliwości serwa.

Kalibracja zapisuje się w `data/ranges.json` (w demo `data-sim/ranges.json`). Tego pliku nie ma w repozytorium i nie jest nadpisywany przy aktualizacji. Kopię rób po zakończeniu ruchu. Nie edytuj go równocześnie z kalibracją w panelu.

## Dopasowanie rysunku

W `Dopasuj rysunek` ustaw kierunek oraz poglądowy kąt przegubu przy 1500 µs. To zmienia wyłącznie obraz i zostaje w pamięci danej przeglądarki. Model zakłada 1000 µs na 90°, co jest przybliżeniem, a nie pomiarem konkretnego SG90. Rozwarcie chwytaka jest względne do zapisanego zakresu. Panel nie rozwiązuje dokładnej kinematyki ani nie mierzy odległości w centymetrach.
