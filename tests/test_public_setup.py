import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

from grippy_control.config import load_joints
from grippy_control.controller import Controller
from grippy_control.server import make_server
from grippy_control.simulation import SimulatedPi


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "config.json"
        self.data = {
            "joints": {
                key: {"name": name, "gpio": gpio}
                for key, (name, gpio, _) in load_joints().items()
            }
        }

    def tearDown(self):
        self.tmp.cleanup()

    def load(self):
        self.path.write_text(json.dumps(self.data))
        return load_joints(self.path)

    def test_custom_pin_is_used_for_output(self):
        self.data["joints"]["S1"]["gpio"] = 5
        joints = self.load()
        self.assertEqual(joints["S1"][2], 29)
        pi = SimulatedPi()
        ctl = Controller(pi, Path(self.tmp.name) / "ranges.json", joints)
        self.assertEqual(pi.calls, [])
        ctl.command({"action": "enable", "ids": ["S1"]})
        with ctl.lock:
            self.assertEqual(pi.pulses, {5: 1500})
        ctl.command({"action": "stop"})

    def test_duplicate_gpio_and_boolean_are_rejected(self):
        for bad in (27, True, 28):
            with self.subTest(bad=bad):
                self.data["joints"]["S1"]["gpio"] = bad
                with self.assertRaises(ValueError):
                    self.load()

    def test_missing_joint_is_rejected(self):
        del self.data["joints"]["S5"]
        with self.assertRaises(ValueError):
            self.load()

    def test_invalid_calibration_cannot_start(self):
        ranges = {s: {"min": 2500, "max": 500} for s in load_joints()}
        self.path.write_text(json.dumps(ranges))
        with self.assertRaises(ValueError):
            Controller(SimulatedPi(), self.path)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pi = SimulatedPi()
        self.ctl = Controller(self.pi, Path(self.tmp.name) / "ranges.json")
        self.server = make_server(self.ctl, 0, simulation=True, token="test-only")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.ctl.command({"action": "stop"})
        self.tmp.cleanup()

    def request(self, method, path, body=None, token=None):
        conn = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=2
        )
        headers = {"X-Control-Token": token} if token else {}
        conn.request(method, path, body, headers)
        response = conn.getresponse()
        result = response.status, response.read()
        conn.close()
        return result

    def test_page_and_state_are_read_only_and_mark_simulation(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        status, raw = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"test-only", raw)
        self.assertNotIn(b"__TOKEN__", raw)
        status, raw = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        state = json.loads(raw)
        self.assertTrue(state["simulation"])
        self.assertTrue(all(j["pulse"] is None for j in state["joints"]))
        self.assertEqual(self.pi.calls, [])

    def test_missing_token_rejects_movement_without_output(self):
        body = json.dumps({"action": "enable", "ids": ["S1"]})
        status, _ = self.request("POST", "/api/command", body)
        self.assertEqual(status, 403)
        self.assertEqual(self.pi.calls, [])

    def test_invalid_json_and_out_of_bounds_return_400(self):
        for body in [
            "{",
            "[]",
            json.dumps({"action": "follow", "targets": {"S1": 9999}}),
        ]:
            status, _ = self.request("POST", "/api/command", body, "test-only")
            self.assertEqual(status, 400)
        self.assertEqual(self.pi.calls, [])

    def test_speed_endpoint_changes_setting_without_output(self):
        status, body = self.request(
            "POST",
            "/api/command",
            json.dumps({"action": "speed", "value": 4000}),
            "test-only",
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["speed"], 4000)
        self.assertEqual(self.pi.calls, [])

    def test_gesture_assets_and_status_are_read_only(self):
        for path in ("/static/gestures.mjs", "/static/gesture-core.mjs",
                     "/static/gesture-worker.mjs", "/static/gestures.css", "/api/vision"):
            with self.subTest(path=path):
                status, raw = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertTrue(raw)
        self.assertEqual(self.pi.calls, [])

    def test_static_paths_cannot_escape_asset_directory(self):
        for path in ("/static/../controller.py", "/static/%2e%2e/server.py",
                     "/static/%2fetc/passwd", "/static/", "/static/missing.js"):
            with self.subTest(path=path):
                status, _ = self.request("GET", path)
                self.assertEqual(status, 404)
        self.assertEqual(self.pi.calls, [])

    def test_gesture_api_requires_token_and_does_not_enable_servos(self):
        body = json.dumps({"action": "gesture_start", "ids": ["S1"],
                           "epoch": 0, "frame": 1, "age_ms": 0})
        self.assertEqual(self.request("POST", "/api/command", body)[0], 403)
        self.assertEqual(self.request("POST", "/api/command", body, "test-only")[0], 400)
        self.assertEqual(self.pi.calls, [])
