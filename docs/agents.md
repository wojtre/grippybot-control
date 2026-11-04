# Pomoc Codex lub Claude Code

Repozytorium zawiera skill `grippybot-setup`, czyli plik `SKILL.md` z instrukcjami dla asystenta. Nie wymaga płatnego API do działania robota. Sam Codex/Claude Code jest opcjonalnym narzędziem do pomocy w instalacji i rozwijaniu kodu; korzystanie z wybranego produktu może wymagać konta lub opłat według jego zasad.

Skill nie instaluje nic automatycznie po skopiowaniu i nie uruchamia ruchu robota. Przeczytaj go przed użyciem: [`SKILL.md`](../skills/grippybot-setup/SKILL.md).

## Codex — skill w tym projekcie

Na komputerze, w katalogu sklonowanego repozytorium:

```bash
mkdir -p .agents/skills
cp -R skills/grippybot-setup .agents/skills/
```

Otwórz ten katalog w Codex lub rozpocznij w nim nową sesję. Przykładowa wiadomość:

```text
Użyj $grippybot-setup i pomóż mi zainstalować panel na Raspberry Pi 4.
Mój system to Raspberry Pi OS Bookworm. Login i host podam, kiedy będą potrzebne.
Nie wykonuj ruchów robota; chcę najpierw sprawdzić konfigurację i połączenie.
```

## Claude Code — skill w tym projekcie

W katalogu repozytorium:

```bash
mkdir -p .claude/skills
cp -R skills/grippybot-setup .claude/skills/
```

Uruchom Claude Code w tym katalogu. Wpisz np.:

```text
/grippybot-setup Pomóż mi uruchomić panel przez SSH. Najpierw sprawdź konfigurację i stan usług, bez ruszania serw.
```

Jeżeli Twoja wersja aplikacji nie pokazuje nowego skilla, rozpocznij nową sesję. Możesz też bez instalacji poprosić asystenta: „Przeczytaj skills/grippybot-setup/SKILL.md w tym repozytorium i pomóż mi zgodnie z nim”.

## Przykłady kolejnych zadań

- „Wyjaśnij mi różnicę między BCM a fizycznym numerem pinu na podstawie tego projektu”.
- „Sprawdź, dlaczego panel nie otwiera się po restarcie Pi. Nie restartuj serw, jeśli są aktywne”.
- „Dodaj nagrywanie pozycji w osobnej gałęzi. Najpierw zaprojektuj to w symulacji”.

Nie wpisuj do czatu hasła Wi-Fi, hasła SSH ani prywatnego klucza. Skill nie daje asystentowi dostępu do urządzenia; połączenie i zakres działań nadal zależą od Twojego środowiska i poleceń.

Oficjalne opisy formatu i lokalizacji: [Skills w Codex / ChatGPT](https://learn.chatgpt.com/docs/build-skills), [Skills w Claude Code](https://code.claude.com/docs/en/skills).
