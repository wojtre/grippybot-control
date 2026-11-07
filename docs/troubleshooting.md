# Gdy coś nie działa

Najpierw ustal, co nie działa: połączenie z Pi, panel czy sam ruch. Diagnostyka poniżej nie wymaga wysyłania nowych pozycji.

## Nie mogę połączyć się po SSH

- Pi musi być uruchomione, a SSH włączone. Komputer i Pi muszą się widzieć w sieci; sieć gościnna może blokować połączenia między urządzeniami.
- Sprawdź login i nazwę hosta ustawione w Imagerze. To nie muszą być `robot` i `grippybot` z przykładów.
- Gdy `.local` nie działa, użyj adresu z listy urządzeń w routerze. `ssh LOGIN@ADRES_IP`.
- Po ponownym wgraniu karty klucz hosta SSH może się zmienić. Nie wyłączaj sprawdzania klucza. Najpierw upewnij się, że to właściwe Pi; usuń stary wpis tylko dla tego hosta zgodnie z komunikatem SSH.
- Nie wysyłaj nikomu haseł ani prywatnego klucza SSH. Plik z końcówką `.pub` jest kluczem publicznym; plik bez `.pub` może być prywatny.

## Pi działa, ale panel się nie otwiera

Na Pi:

```bash
systemctl is-active grippy-pigpiod grippy-panel
journalctl -u grippy-panel -n 50 --no-pager
journalctl -u grippy-pigpiod -n 30 --no-pager
curl http://127.0.0.1:8765/api/state
```

Obie usługi powinny być `active`. Jeśli odpowiedź JSON jest na Pi, ale nie na komputerze, sprawdź tunel SSH. Strona na komputerze to `http://127.0.0.1:8765`. Samo wcześniejsze zalogowanie przez zwykłe `ssh` nie tworzy tunelu.

`Address already in use` na komputerze oznacza zajęty port. Jeżeli panel już działa, zostaw istniejący tunel. Możesz też świadomie użyć innego lokalnego portu:

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8766:127.0.0.1:8765 robot@grippybot.local
```

Wtedy otwórz `http://127.0.0.1:8766`. Nie kończ przypadkowych procesów tylko dlatego, że zajmują port.

## Instalator wykrywa istniejący pigpiod lub panel

Nie uruchamiaj dwóch sterowników tych samych GPIO. Instalator celowo nie zatrzymuje ich za Ciebie. Najpierw ustal ich pochodzenie:

```bash
pgrep -af 'pigpiod|grippy_control|panel.py|serwa.py'
systemctl is-active pigpiod grippy-pigpiod grippy-panel
systemctl is-enabled pigpiod
```

Jeśli to Twój stary zestaw i chcesz przejść na ten projekt: podeprzyj ramię, użyj STOP w starym panelu, odłącz zasilacz serw, zakończ stary program. Jeżeli korzystałeś z usługi dystrybucyjnej `pigpiod`, po potwierdzeniu jej przeznaczenia wyłącz stary autostart:

```bash
sudo systemctl disable --now pigpiod
```

Jeśli były to stare usługi `grippy-panel` i `grippy-pigpiod`, zatrzymaj je przed instalacją/aktualizacją:

```bash
sudo systemctl stop grippy-panel grippy-pigpiod
```

Stary panel może używać tej samej nazwy usługi, ale innego katalogu. Sprawdź `systemctl cat grippy-panel` i zachowaj kopie starej konfiguracji. Ten projekt nie importuje automatycznie kalibracji poprzednich wersji. Po uporządkowaniu uruchom instalator ponownie.

## Panel pokazuje brak pigpio

Instalator wymaga Bookworm z pakietami Raspberry Pi. Sprawdź:

```bash
cat /etc/os-release
apt-cache policy pigpio python3-pigpio
.venv/bin/python -c 'import pigpio; print(pigpio.VERSION)'
```

Środowisko `.venv` musi mieć `--system-site-packages`, aby widzieć pakiet `python3-pigpio` z systemu. Sama instalacja klienta przez pip nie instaluje działającego demona GPIO. Nie rozwiązuj braku pakietów przez wystawienie obcego demona w sieci ani przez wyłączenie zabezpieczeń.

## Przegub nie rusza się

- Sprawdź, czy jesteś w `DEMO`; w tym trybie nic fizycznego nie ruszy.
- Sprawdź checkbox przegubu, tryb na żywo i tekst `sygnał wyłączony` / `Wysłano … µs`.
- Sprawdź oddzielny zasilacz serw, wspólną masę i zgodność BCM z fizycznym pinem.
- Zapisane minimum/maksimum może ograniczać podgląd; edycja samego schematu nie zmienia impulsów.
- Nie zwiększaj granic ani napięcia na ślepo. `1500 µs` jest nominalnym środkiem serwa, nie gwarancją bezkolizyjnego położenia zmontowanego ramienia.

## Serwa drgają, buczą lub poruszają się same

Nie kontynuuj kalibracji z założeniem, że to naprawi drgania. Sprawdź GND, styki, przewody i 5 V pod obciążeniem. Testuj pojedyncze serwo bez obciążenia, z pozostałymi fizycznie odłączonymi od zasilania. Odznaczenie checkboxa odłącza sygnał, nie zasilanie.

Możliwe przyczyny to spadki napięcia, słaba wspólna masa, zakłócenia sygnału, mechaniczny opór lub uszkodzone serwo.

**Jedno serwo „tańczy” kilka sekund po zatrzymaniu, a potem się uspokaja.** Pomiar na prawdziwym robocie pokazał, że program wysyła wtedy idealnie stały impuls — ruch kończy się płynnie, bez cofnięć. To mechanika: luz w plastikowych zębatkach SG90 i ciężar dalszej części ramienia (najczęściej nadgarstek z chwytakiem). Serwo dochodzi do celu, ciężar przechyla je o luz, ono poprawia i przestrzela, aż trafi w punkt równowagi. Sprawdź:

1. Czy przegub nie stoi przy samym MIN/MAX, dociskając do oporu — wtedy zmniejsz zakres o 50–80 µs.
2. Czy taniec znika, gdy podtrzymasz dalszą część ramienia palcami — wtedy winne jest obciążenie; pomoże serwo z metalowymi zębatkami (MG90S).
3. Czy problem przechodzi razem z serwem po zamianie go z innym — wtedy serwo jest zużyte. Stałe wartości w panelu/API wykluczają zmienne zadania tego procesu w danym momencie, ale nie potwierdzają poprawnego przebiegu elektrycznego ani braku innego programu sterującego GPIO.

## Utraciłem połączenie podczas ruchu

Robot może dokończyć ostatnie zadanie i nadal podtrzymywać pozycję. Panel nie ma sprzętowego watchdogu ani odcinania mocy. Podeprzyj ramię i w razie potrzeby odłącz zasilanie serw. Odświeżenie przeglądarki nie jest przyciskiem STOP.
