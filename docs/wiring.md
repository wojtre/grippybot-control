# Podłączenie: osobne zasilanie, wspólna masa

Zasilacz serw odłącz podczas pracy z przewodami. Przed pierwszym podłączeniem zmierz napięcie i polaryzację na adapterze DC. Fizyczne pasowanie wtyczki nie potwierdza zgodności elektrycznej.

```text
ZASILACZ SERW 5 V
  plus  ─────── rozdział +5 V ───── czerwone przewody wszystkich serw
  minus ─────── rozdział GND ──┬─── brązowe przewody wszystkich serw
                              └─── GND Raspberry Pi (fizyczny pin 6)

RASPBERRY PI (zasilane własnym zasilaczem przez USB-C)
  GPIO 17 / pin 11 ──────────────── sygnał S1 (podstawa)
  GPIO 27 / pin 13 ──────────────── sygnał S2 (bark)
  GPIO 22 / pin 15 ──────────────── sygnał S3 (łokieć)
  GPIO 23 / pin 16 ──────────────── sygnał S4 (nadgarstek)
  GPIO 24 / pin 18 ──────────────── sygnał S5 (chwytak)
```

Sygnał w typowym SG90 jest pomarańczowy lub żółty. Sprawdź oznaczenia konkretnego serwa — kolor to wskazówka, nie pomiar.

- Wszystkie serwa zasilasz **równolegle**, nie szeregowo.
- Zasilacz serw i Pi mają wspólny GND. Nie łącz plusa osobnego zasilacza serw z pinem 5 V Pi w tym wariancie.
- Prąd silników ma wracać prosto do minusa ich zasilacza. Przewód GND do Pi zapewnia wspólne odniesienie dla sygnałów; nie powinien być jedyną drogą powrotu prądu silników.
- WAGO łączy wspólną szynę. Sprawdź model złączki, dopuszczalny przekrój i sposób odizolowania. Nie wkładaj styku Dupont zamiast prawidłowo przygotowanego przewodu, jeśli złączka nie jest do tego przeznaczona.
- Jeden cienki przewód Dupont nie jest dobrym wspólnym przewodem zasilania pięciu serw. Dobierz przewody do rzeczywistego prądu i długości. Trzymaj nieizolowane końcówki oddzielnie, sprawdź mocowanie delikatnym pociągnięciem przy odłączonym zasilaniu.
- Numery `GPIO` w kodzie to **BCM**, a nie numery kolejnych nóżek. Fizyczny pin 11 to BCM 17. Nie licz pinów na podstawie przypadkowej orientacji zdjęcia; użyj [oficjalnego opisu złącza GPIO](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#gpio).

Jeśli używasz innych pinów, edytuj `config.json`. Przykład struktury jest w `config.example.json`. Program wymaga pięciu unikalnych GPIO BCM 2–27, sam oblicza fizyczne numery pinów. Wolny numer w konfiguracji nie oznacza, że ten GPIO nie jest zajęty przez inną funkcję systemu (np. UART/SPI/I²C).

**Drgania:** najpierw sprawdź połączenia i napięcie pod obciążeniem, a potem pojedyncze, odciążone serwo z pozostałymi fizycznie odłączonymi. Sam STOP wyłącza sygnał, lecz zasilanie pozostaje. Sygnał zadany stały w API nie dowodzi, że przebieg na przewodzie ani napięcie zasilania są poprawne. Więcej: [diagnostyka](troubleshooting.md).
