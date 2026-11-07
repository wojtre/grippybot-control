"""Download pinned local MediaPipe assets; never import or connect to GPIO."""

import hashlib
import json
from pathlib import Path
import sys
from urllib.request import urlopen

ROOT = Path(__file__).parent
DEST = ROOT / "static" / "vendor"


def manifest():
    return json.loads((ROOT / "vision-assets.json").read_text())


def assets_ready():
    return all(
        (DEST / name).is_file() and (DEST / name).stat().st_size == spec["size"]
        for name, spec in manifest().items()
    )


def prepare():
    for name, spec in manifest().items():
        path = DEST / name
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == spec["sha256"]:
            print(f"Gotowe: {name}")
            continue
        print(f"Pobieranie: {name}", flush=True)
        with urlopen(spec["url"], timeout=60) as response:
            raw = response.read(spec["size"] + 1)
        if len(raw) != spec["size"] or hashlib.sha256(raw).hexdigest() != spec["sha256"]:
            raise ValueError("Niezgodna suma kontrolna: " + name)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".download")
        tmp.write_bytes(raw)
        tmp.replace(path)
    print("Modele gotowe. Otwórz zakładkę Gesty; obraz pozostaje na komputerze.")


if __name__ == "__main__":
    try:
        prepare()
    except (OSError, ValueError) as exc:
        sys.exit(f"Nie udało się przygotować modeli: {exc}")
