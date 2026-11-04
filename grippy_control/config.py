"""Configurable names and BCM pins; pulse limits live in a separate local file."""

import json
from pathlib import Path

DEFAULT_JOINTS = {
    "S1": ("Podstawa", 17, 11),
    "S2": ("Bark", 27, 13),
    "S3": ("Łokieć", 22, 15),
    "S4": ("Nadgarstek", 23, 16),
    "S5": ("Chwytak", 24, 18),
}
# Physical positions on the 40-pin Pi header (BCM -> physical pin).
PHYSICAL_PINS = {
    2: 3,
    3: 5,
    4: 7,
    5: 29,
    6: 31,
    7: 26,
    8: 24,
    9: 21,
    10: 19,
    11: 23,
    12: 32,
    13: 33,
    14: 8,
    15: 10,
    16: 36,
    17: 11,
    18: 12,
    19: 35,
    20: 38,
    21: 40,
    22: 15,
    23: 16,
    24: 18,
    25: 22,
    26: 37,
    27: 13,
}


def load_joints(path=None):
    if path is None:
        return dict(DEFAULT_JOINTS)
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"joints"}:
        raise ValueError("Konfiguracja wymaga jednego pola joints.")
    joints = data["joints"]
    if not isinstance(joints, dict) or set(joints) != set(DEFAULT_JOINTS):
        raise ValueError("W konfiguracji muszą być dokładnie S1, S2, S3, S4 i S5.")
    result = {}
    used = set()
    for key, item in joints.items():
        if not isinstance(item, dict) or set(item) != {"name", "gpio"}:
            raise ValueError(f"{key}: wymagane name i gpio.")
        name, gpio = item["name"], item["gpio"]
        if not isinstance(name, str) or not name.strip() or len(name) > 40:
            raise ValueError(f"{key}: nazwa musi mieć od 1 do 40 znaków.")
        if type(gpio) is not int or gpio not in PHYSICAL_PINS or gpio in used:
            raise ValueError(f"{key}: wybierz unikalny GPIO BCM od 2 do 27.")
        used.add(gpio)
        result[key] = (name, gpio, PHYSICAL_PINS[gpio])
    return {key: result[key] for key in DEFAULT_JOINTS}
