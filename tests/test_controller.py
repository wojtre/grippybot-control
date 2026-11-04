import tempfile
import time
import unittest
from pathlib import Path
from grippy_control import controller as m
from grippy_control.simulation import SimulatedPi as FakePi


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pi = FakePi()
        self.ctl = m.Controller(self.pi, Path(self.tmp.name) / "ranges.json")

    def tearDown(self):
        self.ctl.command({"action": "stop"})
        self.tmp.cleanup()

    def wait(self):
        limit = time.monotonic() + 4
        while self.ctl.busy and time.monotonic() < limit:
            time.sleep(0.005)
        self.assertFalse(self.ctl.busy)

    def test_no_output_on_open_and_read(self):
        self.ctl.state()
        self.assertEqual(self.pi.calls, [])

    def test_reject_active_outputs(self):
        self.pi.pulses[17] = 1500
        with self.assertRaises(RuntimeError):
            m.Controller(self.pi, Path(self.tmp.name) / "b.json")

    def test_enable_two_and_move_together(self):
        self.ctl.command({"action": "enable", "ids": ["S1", "S2"]})
        self.wait()
        self.ctl.command(
            {"action": "move", "ids": ["S1", "S2"], "targets": {"S1": 1600, "S2": 1400}}
        )
        self.wait()
        self.assertEqual(self.pi.pulses, {17: 1600, 27: 1400})
        self.assertTrue(all(1400 <= p <= 1600 for _, p in self.pi.calls))
        self.assertEqual(set(g for g, _ in self.pi.calls), {17, 27})

    def test_invalid_group_is_atomic(self):
        self.ctl.command({"action": "enable", "ids": ["S1", "S2"]})
        self.wait()
        self.pi.calls.clear()
        with self.assertRaises(ValueError):
            self.ctl.command(
                {
                    "action": "move",
                    "ids": ["S1", "S2"],
                    "targets": {"S1": 1550, "S2": 2000},
                }
            )
        self.assertEqual(self.pi.calls, [])

    def test_stops_ramp_and_remains_off(self):
        self.ctl.command({"action": "enable", "ids": ["S2"]})
        self.wait()
        self.ctl.command({"action": "move", "ids": ["S2"], "targets": {"S2": 1600}})
        time.sleep(0.025)
        self.ctl.command({"action": "stop"})
        self.wait()
        n = len(self.pi.calls)
        time.sleep(0.05)
        self.assertEqual(self.pi.pulses[27], 0)
        self.assertEqual(len(self.pi.calls), n)

    def test_no_move_while_off(self):
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "move", "ids": ["S1"], "targets": {"S1": 1500}})
        self.assertEqual(self.pi.calls, [])

    def test_calibration_and_persistence(self):
        self.ctl.command({"action": "enable", "ids": ["S3"]})
        self.wait()
        self.ctl.position["S3"] = 1400
        self.pi.pulses[22] = 1400
        self.ctl.command({"action": "step", "ids": ["S3"], "delta": -100})
        self.wait()
        self.assertEqual(self.ctl.position["S3"], 1300)
        self.assertEqual(self.ctl.bounds["S3"]["min"], 1400)
        self.ctl.command({"action": "save", "ids": ["S3"], "edge": "min"})
        self.assertEqual(self.ctl.bounds["S3"]["min"], 1300)
        self.ctl.command({"action": "stop"})
        c = m.Controller(self.pi, self.ctl.path)
        self.assertEqual(c.bounds["S3"]["min"], 1300)

    def test_reject_big_calibration_steps(self):
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "step", "ids": ["S2"], "delta": 500})
        self.assertEqual(self.pi.calls, [])

    def test_follow_coalesces_latest_target_and_stop(self):
        self.ctl.command({"action": "enable", "ids": ["S1", "S2"]})
        self.wait()
        self.ctl.command({"action": "follow", "targets": {"S1": 1600, "S2": 1400}})
        time.sleep(0.04)
        self.ctl.command({"action": "follow", "targets": {"S1": 1450, "S2": 1550}})
        self.wait()
        self.assertEqual(self.ctl.position["S1"], 1450)
        self.assertEqual(self.ctl.position["S2"], 1550)
        self.ctl.command({"action": "follow", "targets": {"S1": 1600}})
        time.sleep(0.025)
        self.ctl.command({"action": "stop"})
        n = len(self.pi.calls)
        time.sleep(0.05)
        self.assertEqual(self.pi.pulses[17], 0)
        self.assertEqual(len(self.pi.calls), n)
        self.assertFalse(self.ctl.following)

    def test_follow_validation_atomic_and_no_implicit_enable(self):
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "follow", "targets": {"S1": 1500}})
        self.assertEqual(self.pi.calls, [])
        self.ctl.command({"action": "enable", "ids": ["S1"]})
        self.wait()
        self.pi.calls.clear()
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "follow", "targets": {"S1": 1550, "S2": 1500}})
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "follow", "targets": {"S1": 1601}})
        self.assertEqual(self.pi.calls, [])

    def test_follow_equal_target_and_rapid_restart(self):
        self.ctl.command({"action": "enable", "ids": ["S1"]})
        self.wait()
        for i in range(40):
            self.ctl.command(
                {"action": "follow", "targets": {"S1": 1500 + (i % 2) * 5}}
            )
            time.sleep(0.002)
        self.wait()
        self.assertEqual(self.ctl.position["S1"], 1505)
        self.assertFalse(self.ctl.lock.locked())

    def test_disable_one_while_following_keeps_other_running(self):
        self.ctl.command({"action": "enable", "ids": ["S1", "S2"]})
        self.wait()
        self.ctl.command({"action": "follow", "targets": {"S1": 1600, "S2": 1400}})
        time.sleep(0.03)
        self.ctl.command({"action": "disable", "ids": ["S1"]})
        n = len(self.pi.calls)
        self.wait()
        self.assertIsNone(self.ctl.position["S1"])
        self.assertEqual(self.ctl.position["S2"], 1400)
        self.assertFalse(any(g == 17 and p > 0 for g, p in self.pi.calls[n:]))

    def test_disable_during_ramp_and_explicit_reenable(self):
        self.ctl.command({"action": "enable", "ids": ["S1", "S2"]})
        self.wait()
        self.ctl.command(
            {"action": "move", "ids": ["S1", "S2"], "targets": {"S1": 1600, "S2": 1400}}
        )
        time.sleep(0.03)
        self.ctl.command({"action": "disable", "ids": ["S1"]})
        n = len(self.pi.calls)
        self.wait()
        self.assertFalse(any(g == 17 and p > 0 for g, p in self.pi.calls[n:]))
        self.assertEqual(self.ctl.position["S2"], 1400)
        self.ctl.command({"action": "enable", "ids": ["S1"]})
        self.wait()
        self.assertEqual(self.ctl.position["S1"], 1500)

    def test_disable_invalid_group_is_atomic(self):
        self.ctl.command({"action": "enable", "ids": ["S1"]})
        self.wait()
        self.pi.calls.clear()
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "disable", "ids": ["S1", "bad"]})
        self.assertEqual(self.pi.calls, [])

    def test_speed_setting_has_no_output_and_is_validated(self):
        self.ctl.command({"action": "speed", "value": 1000})
        self.assertEqual(self.ctl.state()["speed"], 1000)
        self.assertEqual(self.pi.calls, [])
        for bad in [0, -1, 2500, True, 125.0]:
            with self.assertRaises(ValueError):
                self.ctl.command({"action": "speed", "value": bad})
        self.assertEqual(self.ctl.speed, 1000)

    def test_speed_multipliers_in_ramp_and_follow(self):
        self.ctl.command({"action": "enable", "ids": ["S1"]})
        self.wait()
        for speed in (1000, 2000, 4000):
            with self.subTest(speed=speed):
                self.ctl.command({"action": "speed", "value": speed})
                for action, target in [("move", 1600), ("follow", 1500)]:
                    self.pi.calls.clear()
                    body = {"action": action, "targets": {"S1": target}}
                    if action == "move":
                        body["ids"] = ["S1"]
                    self.ctl.command(body)
                    self.wait()
                    self.assertEqual(self.ctl.position["S1"], target)
                    self.assertEqual(
                        len(self.pi.calls),
                        __import__("math").ceil(100 / (speed * 0.02)),
                    )


if __name__ == "__main__":
    unittest.main()
