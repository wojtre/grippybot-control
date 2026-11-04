#!/usr/bin/env bash
# Run as the ordinary Pi login, from a reviewed checkout. Never run as root.
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == '--help' ]]; then
 echo 'bash scripts/install-pi.sh [--dry-run]'
 echo 'Instaluje pakiety i usługi na Raspberry Pi 4 / Raspberry Pi OS Bookworm.'
 exit 0
fi
if [[ -n "${1:-}" && "${1:-}" != '--dry-run' ]]; then echo 'Nieznana opcja.' >&2; exit 2; fi
if [[ "${1:-}" == '--dry-run' ]]; then
 echo "Plan: katalog $repo_dir, bieżący użytkownik, Python venv, pakiety apt: pigpio python3-pigpio python3-venv."
 echo 'Wyłączenie nieużywanej standardowej usługi pigpiod z pakietu, żeby nie dublować sterownika.'
 echo 'Usługi grippy-pigpiod (tylko lokalnie :8889) oraz grippy-panel (tylko lokalnie :8765).'
 echo 'config.json i data/ranges.json są zachowywane. Start nie wysyła impulsów do serw.'
 exit 0
fi
[[ "$EUID" != 0 ]] || { echo 'Uruchom bez sudo; skrypt sam poprosi o uprawnienia do instalacji.' >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || { echo 'Ten instalator uruchamia się na Raspberry Pi, nie na Macu/PC.' >&2; exit 1; }
model="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
case "$model" in
 *'Raspberry Pi 4 Model B'*|*'Raspberry Pi 400'*) ;;
 *) echo "Nieobsługiwany model: $model. Wersja referencyjna wymaga Pi 4/400; Pi 5 nie jest obsługiwane." >&2; exit 1 ;;
esac
# shellcheck disable=SC1091
source /etc/os-release
[[ "${VERSION_CODENAME:-}" == bookworm ]] || { echo 'Instalator wymaga Raspberry Pi OS Bookworm. Dla innych wersji zobacz README.' >&2; exit 1; }
if systemctl is-active --quiet grippy-panel.service; then
 echo 'Panel już działa. Przed aktualizacją podeprzyj ramię, STOP, odłącz zasilacz serw i zatrzymaj usługę zgodnie z README.' >&2
 exit 1
fi
if systemctl is-active --quiet grippy-pigpiod.service || pgrep -x pigpiod >/dev/null; then
 echo 'Sterownik pigpiod już działa. Nie przejmuję istniejącego sterowania; zobacz docs/troubleshooting.md.' >&2
 exit 1
fi
if systemctl is-enabled --quiet pigpiod.service 2>/dev/null; then
 echo 'Istniejąca usługa pigpiod ma autostart. Najpierw uporządkuj ją zgodnie z docs/troubleshooting.md.' >&2
 exit 1
fi
sudo apt-get update
sudo apt-get install -y pigpio python3-pigpio python3-venv
# Preflight established there was no active/enabled distribution daemon.
# A newly installed package may have started/enabled its own service.
sudo systemctl disable --now pigpiod.service
cd -- "$repo_dir"
python3 -m venv --system-site-packages .venv
.venv/bin/python -c 'import pigpio'
if [[ ! -e config.json ]]; then cp config.example.json config.json; fi
mkdir -p data
.venv/bin/python -m grippy_control --config config.json --data-dir data --check-config
unit_dir="$(mktemp -d)"
trap 'rm -rf -- "$unit_dir"' EXIT
.venv/bin/python scripts/services.py --output "$unit_dir"
sudo install -m 644 "$unit_dir/grippy-pigpiod.service" /etc/systemd/system/grippy-pigpiod.service
sudo install -m 644 "$unit_dir/grippy-panel.service" /etc/systemd/system/grippy-panel.service
sudo systemctl daemon-reload
sudo systemctl enable --now grippy-pigpiod.service grippy-panel.service
.venv/bin/python scripts/doctor.py --wait 12
printf '\nGotowe. Panel działa lokalnie na Pi: http://127.0.0.1:8765\n'
printf 'Teraz z komputera utwórz tunel SSH według README. Nie włączono sygnałów serw.\n'
