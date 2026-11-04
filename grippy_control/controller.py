"""Servo commands, coalesced live targets and local pulse-width calibration."""

import json
import os
from pathlib import Path
import threading

from .config import DEFAULT_JOINTS


class Controller:
    def __init__(self, pi, config_path, joints=None):
        self.joints = dict(DEFAULT_JOINTS if joints is None else joints)
        self.pi = pi
        self.path = Path(config_path)
        self.lock = threading.Lock()
        self.state_lock = threading.RLock()
        self.cancel = threading.Event()
        self.busy = False
        self.stopping = False
        self.following = False
        self.follow_targets = {}
        self.suppressed = set()
        self.speed = 250
        self.error = ""
        self.position = {s: None for s in self.joints}
        self.bounds = {
            s: {"min": 1400, "max": 1600, "min_saved": False, "max_saved": False}
            for s in self.joints
        }
        if self.path.exists():
            data = json.loads(self.path.read_text())
            for s in self.joints:
                b = data.get(s, self.bounds[s])
                if not (
                    type(b["min"]) is int
                    and type(b["max"]) is int
                    and 500 <= b["min"] <= 1500 <= b["max"] <= 2500
                    and b["min"] < b["max"]
                ):
                    raise ValueError("Nieprawidłowy plik zakresów: " + s)
                self.bounds[s] = b
        # Read only. Refuse to take over an output left active by another program.
        for s, (_, gpio, _) in self.joints.items():
            try:
                pulse = pi.get_servo_pulsewidth(gpio)
            except Exception as exc:
                if "GPIO is not in use for servo pulses" in str(exc):
                    pulse = 0
                else:
                    raise
            if pulse > 0:
                raise RuntimeError(
                    f"{s} ma już aktywny sygnał. Zakończ poprzedni sterownik przed uruchomieniem panelu."
                )

    def state(self):
        with self.state_lock:
            return {
                "busy": self.busy,
                "following": self.following,
                "speed": self.speed,
                "error": self.error,
                "joints": [
                    {
                        "id": s,
                        "name": name,
                        "gpio": gpio,
                        "pin": pin,
                        "pulse": self.position[s],
                        **self.bounds[s],
                    }
                    for s, (name, gpio, pin) in self.joints.items()
                ],
            }

    def _send(self, s, pulse):
        with self.state_lock:
            if pulse and s in self.suppressed:
                return
            result = self.pi.set_servo_pulsewidth(self.joints[s][1], pulse)
            if result < 0:
                raise RuntimeError(f"{s}: błąd sterownika {result}")
            self.position[s] = pulse if pulse else None

    def _ramp(self, targets):
        with self.state_lock:
            targets = {s: v for s, v in targets.items() if self.position[s] is not None}
            start = {s: self.position[s] for s in targets}
        if not targets:
            return
        distance = max(abs(targets[s] - start[s]) for s in targets)
        progress = 0.0
        while progress < distance:
            if self.cancel.is_set():
                return
            with self.state_lock:
                progress = min(distance, progress + self.speed * 0.02)
            for s, target in targets.items():
                if self.cancel.is_set():
                    return
                self._send(
                    s, round(start[s] + (target - start[s]) * progress / distance)
                )
            if self.cancel.wait(0.02):
                return

    def _work(self, action, ids, targets):
        try:
            if action == "enable":
                already = {s: 1500 for s in ids if self.position[s] is not None}
                for s in ids:
                    if self.cancel.is_set():
                        return
                    if self.position[s] is None:
                        self._send(s, 1500)
                if already:
                    self._ramp(already)
            else:
                self._ramp(targets)
        except Exception as exc:
            with self.state_lock:
                self.error = str(exc)
            # A driver error does not silently command other joints to a home pose.
            for s in list(self.joints):
                if self.position[s] is not None:
                    try:
                        self._send(s, 0)
                    except Exception:
                        pass
        finally:
            with self.state_lock:
                self.busy = False
            self.lock.release()

    def command(self, data):
        action = data.get("action")
        if action == "speed":
            value = data.get("value")
            if type(value) is not int or value not in (125, 250, 500, 1000, 2000, 4000):
                raise ValueError("Wybierz prędkość 0,5×, 1×, 2×, 4×, 8× lub 16×.")
            with self.state_lock:
                self.speed = value
            return
        if action == "disable":
            ids = data.get("ids", [])
            if (
                not isinstance(ids, list)
                or not ids
                or any(s not in self.joints for s in ids)
            ):
                raise ValueError("Wybierz poprawne serwa.")
            with self.state_lock:
                for s in ids:
                    self.suppressed.add(s)
                    self.follow_targets.pop(s, None)
                    if self.position[s] is not None:
                        self._send(s, 0)
            return
        if action == "follow":
            # Only the latest target survives; dragging never builds a motion queue.
            with self.state_lock:
                if self.stopping:
                    raise ValueError("Trwa STOP.")
                values = data.get("targets")
                if (
                    not isinstance(values, dict)
                    or not values
                    or any(s not in self.joints for s in values)
                ):
                    raise ValueError("Nieprawidłowa pozycja.")
                for s, v in values.items():
                    b = self.bounds[s]
                    if type(v) is not int or not b["min"] <= v <= b["max"]:
                        raise ValueError("Pozycja poza zakresem " + s)
                    if self.position[s] is None:
                        raise ValueError("Najpierw włącz " + s + ".")
                if self.following:
                    self.follow_targets.update(values)
                    return
                if not self.lock.acquire(blocking=False):
                    raise ValueError("Poczekaj na zakończenie ruchu.")
                self.follow_targets = dict(values)
                self.following = True
                self.busy = True
                self.error = ""
                self.cancel.clear()
                threading.Thread(target=self._follow_work, daemon=True).start()
            return
        if action == "stop":
            # STOP takes priority over any new movement request.
            with self.state_lock:
                self.stopping = True
                self.cancel.set()
            try:
                with self.lock:
                    failures = []
                    for s in self.joints:
                        if self.position[s] is not None:
                            try:
                                self._send(s, 0)
                            except Exception as exc:
                                failures.append(str(exc))
                    if failures:
                        raise RuntimeError("; ".join(failures))
            finally:
                with self.state_lock:
                    self.stopping = False
            return
        if not self.lock.acquire(blocking=False):
            raise ValueError("Ruch w toku. Poczekaj albo użyj STOP.")
        launched = False
        try:
            ids = data.get("ids", [])
            if (
                not isinstance(ids, list)
                or not ids
                or len(set(ids)) != len(ids)
                or any(s not in self.joints for s in ids)
            ):
                raise ValueError("Wybierz poprawne serwa.")
            targets = {}
            if action == "move":
                values = data.get("targets", {})
                if not isinstance(values, dict) or set(values) != set(ids):
                    raise ValueError("Niepełna pozycja.")
                for s in ids:
                    v = values[s]
                    b = self.bounds[s]
                    if type(v) is not int or not b["min"] <= v <= b["max"]:
                        raise ValueError("Pozycja poza zakresem " + s)
                    if self.position[s] is None:
                        raise ValueError("Najpierw włącz " + s + " na środek.")
                    targets[s] = v
            elif action == "step":
                if len(ids) != 1:
                    raise ValueError("Kalibruj jeden przegub naraz.")
                s = ids[0]
                delta = data.get("delta")
                if type(delta) is not int or delta not in (-100, 100):
                    raise ValueError("Krok kalibracji to 100 µs.")
                if self.position[s] is None:
                    raise ValueError("Najpierw włącz wybrane serwo.")
                v = self.position[s] + delta
                if not 500 <= v <= 2500:
                    raise ValueError("Osiągnięto techniczną granicę programu.")
                targets[s] = v
            elif action == "save":
                if len(ids) != 1:
                    raise ValueError("Zapisuj jeden przegub naraz.")
                s = ids[0]
                edge = data.get("edge")
                v = self.position[s]
                if v is None or edge not in ("min", "max"):
                    raise ValueError("Brak pozycji do zapisania.")
                b = dict(self.bounds[s])
                b[edge] = v
                b[edge + "_saved"] = True
                if not (
                    500 <= b["min"] <= 1500 <= b["max"] <= 2500 and b["min"] < b["max"]
                ):
                    raise ValueError(
                        "Dolna granica musi być ≤1500, górna ≥1500; zakres nie może być pusty."
                    )
                new = {k: dict(v) for k, v in self.bounds.items()}
                new[s] = b
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(new, ensure_ascii=False, indent=2))
                os.replace(tmp, self.path)
                with self.state_lock:
                    self.bounds = new
                return
            elif action != "enable":
                raise ValueError("Nieznane polecenie.")
            with self.state_lock:
                if self.stopping:
                    raise ValueError("Zatrzymywanie. Poczekaj na zakończenie STOP.")
                self.cancel.clear()
                self.busy = True
                self.error = ""
                if action == "enable":
                    self.suppressed.difference_update(ids)
            threading.Thread(
                target=self._work, args=(action, ids, targets), daemon=True
            ).start()
            launched = True
        finally:
            if not launched:
                self.lock.release()

    def _follow_work(self):
        released = False
        fraction = 0.0
        try:
            while not self.cancel.is_set():
                with self.state_lock:
                    pending = {
                        s: v
                        for s, v in self.follow_targets.items()
                        if self.position[s] != v
                    }
                    if not pending:
                        self.following = False
                        self.busy = False
                        self.lock.release()
                        released = True
                        return
                    fraction += self.speed * 0.02
                    step = int(fraction)
                    fraction -= step
                    for s, target in pending.items():
                        if self.cancel.is_set():
                            break
                        current = self.position[s]
                        self._send(s, current + max(-step, min(step, target - current)))
                if self.cancel.wait(0.02):
                    break
                # Exit/release happens under the same lock as a target update.
                with self.state_lock:
                    if all(
                        self.position[s] == v for s, v in self.follow_targets.items()
                    ):
                        self.following = False
                        self.busy = False
                        self.lock.release()
                        released = True
                        return
        except Exception as exc:
            with self.state_lock:
                self.error = str(exc)
            for s in self.joints:
                if self.position[s] is not None:
                    try:
                        self._send(s, 0)
                    except Exception:
                        pass
        finally:
            with self.state_lock:
                if not released:
                    self.following = False
                    self.busy = False
                    self.lock.release()
