#!/usr/bin/env python3
"""Render systemd units for the current checkout/user; do not install or start them."""

import argparse
import os
from pathlib import Path
import pwd
import re


def quoted(value):
    value = str(value)
    if "\n" in value or "\r" in value:
        raise ValueError("Ścieżka nie może zawierać końca wiersza.")
    return (
        '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'
    )


def render(root, user):
    root = Path(root).resolve()
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_-]*\$?", user):
        raise ValueError("Niepoprawny login użytkownika.")
    return {
        "grippy-pigpiod.service": """[Unit]
Description=Grippy Bot local pigpio daemon

[Service]
Type=simple
ExecStart=/usr/bin/pigpiod -g -l -f -p 8889
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
""",
        "grippy-panel.service": f"""[Unit]
Description=Grippy Bot browser controller (no servo signals at startup)
Requires=grippy-pigpiod.service
After=grippy-pigpiod.service

[Service]
Type=simple
User={user}
WorkingDirectory={str(root).replace("%", "%%")}
ExecStart={quoted(root / '.venv/bin/python')} -m grippy_control --config {quoted(root / 'config.json')} --data-dir {quoted(root / 'data')}
Restart=on-failure
RestartSec=3
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
""",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    user = pwd.getpwuid(os.getuid()).pw_name
    if user == "root":
        parser.error("Uruchom jako zwykły użytkownik, bez sudo.")
    for name, content in render(root, user).items():
        (args.output / name).write_text(content, encoding="utf-8")
        print(name)


if __name__ == "__main__":
    main()
