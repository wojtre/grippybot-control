"""Loopback-only HTTP panel. Hardware mode requires the local pigpio daemon."""

import argparse
import fcntl
import json
import mimetypes
from pathlib import Path
import secrets
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from socketserver import TCPServer
from urllib.parse import urlsplit, unquote

from .config import load_joints
from .controller import Controller
from .simulation import SimulatedPi

PAGE = Path(__file__).with_name("panel.html")
STATIC = PAGE.parent / "static"


class LocalHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # This loopback service does not need a reverse DNS lookup at startup.
        TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


def make_server(controller, port=8765, simulation=False, token=None):
    token = token or secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *args):
            pass

        def state(self):
            return {**controller.state(), "simulation": simulation}

        def reply(self, code, obj):
            raw = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path == "/api/state":
                return self.reply(200, self.state())
            if self.path == "/api/vision":
                from .prepare_vision import assets_ready
                return self.reply(200, {"ready": assets_ready(), "version": "0.10.21"})
            path = unquote(urlsplit(self.path).path)
            if path.startswith("/static/"):
                root = STATIC.resolve()
                asset = (root / path[len("/static/"):]).resolve()
                if not asset.is_relative_to(root) or not asset.is_file():
                    return self.reply(404, {"error": "Brak pliku panelu lub modeli."})
                content_type = {
                    ".mjs": "text/javascript", ".js": "text/javascript",
                    ".wasm": "application/wasm", ".task": "application/octet-stream",
                }.get(asset.suffix, mimetypes.guess_type(asset.name)[0] or "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(asset.stat().st_size))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                with asset.open("rb") as source:
                    import shutil
                    shutil.copyfileobj(source, self.wfile)
                return
            if self.path != "/":
                return self.reply(404, {"error": "Nie znaleziono."})
            raw = PAGE.read_text(encoding="utf-8").replace("__TOKEN__", token).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            if self.path != "/api/command":
                return self.reply(404, {"error": "Nie znaleziono."})
            if not secrets.compare_digest(
                self.headers.get("X-Control-Token", ""), token
            ):
                return self.reply(403, {"error": "Odśwież panel."})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size < 8192:
                    raise ValueError("Niepoprawna wielkość żądania.")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("Niepoprawne żądanie.")
                controller.command(data)
                self.reply(200, self.state())
            except (ValueError, RuntimeError, KeyError, TypeError) as exc:
                self.reply(400, {"error": str(exc)})

    return LocalHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser(
        description="Grippy Bot: lokalny panel sterowania."
    )
    parser.add_argument(
        "--simulate", action="store_true", help="Demo bez GPIO i bez pigpio."
    )
    parser.add_argument("--config", type=Path, help="Własne nazwy i piny z pliku JSON.")
    parser.add_argument(
        "--data-dir", type=Path, help="Katalog na zakresy i blokadę procesu."
    )
    parser.add_argument(
        "--port", type=int, default=8765, help="Port panelu, domyślnie 8765."
    )
    parser.add_argument("--pigpio-port", type=int, default=8889)
    parser.add_argument(
        "--check-config",
        action="store_true",
        help="Sprawdź konfigurację bez GPIO i bez serwera.",
    )
    args = parser.parse_args()
    if not (1 <= args.port <= 65535 and 1 <= args.pigpio_port <= 65535):
        parser.error("Port musi być liczbą od 1 do 65535.")
    try:
        joints = load_joints(args.config)
        data_dir = args.data_dir or Path("data-sim" if args.simulate else "data")
        if args.check_config:
            Controller(SimulatedPi(), data_dir / "ranges.json", joints)
            print("Konfiguracja poprawna. Nie połączono z GPIO.")
            return
        data_dir.mkdir(parents=True, exist_ok=True)
        with (data_dir / ".controller.lock").open("a") as lock_file:
            try:
                fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError(
                    "Ten katalog danych jest już używany przez inny panel."
                )
            if args.simulate:
                pi = SimulatedPi()
            else:
                try:
                    import pigpio
                except ImportError:
                    raise RuntimeError(
                        "Brak pigpio. Użyj instalatora opisanego w README albo --simulate."
                    )
                pi = pigpio.pi("localhost", args.pigpio_port, show_errors=False)
                if not pi.connected:
                    raise RuntimeError(
                        "Brak lokalnego pigpiod. Sprawdź usługę grippy-pigpiod."
                    )
            try:
                ctl = Controller(pi, data_dir / "ranges.json", joints)
                server = make_server(ctl, args.port, args.simulate)

                def stop_signal(*_):
                    raise KeyboardInterrupt

                signal.signal(signal.SIGTERM, stop_signal)
                mode = (
                    "SYMULACJA — brak sprzętu"
                    if args.simulate
                    else "SPRZĘT — sygnały na starcie wyłączone"
                )
                print(
                    f"{mode}. Panel: http://127.0.0.1:{server.server_port}", flush=True
                )
                try:
                    server.serve_forever()
                except KeyboardInterrupt:
                    pass
                finally:
                    ctl.command({"action": "stop"})
                    server.server_close()
            finally:
                pi.stop()
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"Błąd: {exc}\n")
