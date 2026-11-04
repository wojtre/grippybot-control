#!/usr/bin/env python3
"""Read-only check of the local panel; sends no servo commands."""

import argparse
import json
import time
from urllib.request import urlopen
from urllib.error import URLError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--wait", type=float, default=0)
    args = parser.parse_args()
    until = time.monotonic() + max(0, args.wait)
    while True:
        try:
            with urlopen(
                f"http://127.0.0.1:{args.port}/api/state", timeout=2
            ) as response:
                state = json.load(response)
            if len(state["joints"]) != 5:
                raise ValueError("Nieoczekiwany format panelu.")
            break
        except (OSError, URLError, ValueError, KeyError) as exc:
            if time.monotonic() >= until:
                parser.exit(
                    1,
                    f"Panel nie odpowiada: {exc}\nSprawdź usługę grippy-panel i tunel SSH.\n",
                )
            time.sleep(0.5)
    print("DEMO bez sprzętu" if state.get("simulation") else "Panel sprzętowy")
    print(f'Prędkość: {state["speed"] / 250:g}×; ruch w toku: {state["busy"]}')
    for joint in state["joints"]:
        pulse = joint["pulse"]
        value = (
            "sygnał wyłączony"
            if pulse is None
            else f"zadano {pulse} µs (to nie pomiar kąta)"
        )
        print(f'{joint["id"]}: {value}')
    if state["error"]:
        parser.exit(1, f'Błąd sterownika: {state["error"]}\n')


if __name__ == "__main__":
    main()
