"""Gesture leases are tested against simulated pulses, never GPIO."""
import tempfile
import time
import unittest
from pathlib import Path

from grippy_control.controller import Controller
from grippy_control.simulation import SimulatedPi


class GestureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pi = SimulatedPi()
        self.ctl = Controller(self.pi, Path(self.tmp.name) / "ranges.json")

    def tearDown(self):
        self.ctl.command({"action": "stop"})
        self.tmp.cleanup()

    def idle(self):
        deadline = time.monotonic() + 2
        while self.ctl.busy and time.monotonic() < deadline:
            time.sleep(.005)
        self.assertFalse(self.ctl.busy)

    def enable(self, ids=("S1", "S5")):
        self.ids = list(ids)
        self.ctl.command({"action": "enable", "ids": self.ids})
        self.idle()

    def start(self, **changes):
        body = {"action": "gesture_start", "ids": self.ids,
                "epoch": self.ctl.state()["gesture"]["epoch"], "frame": 1, "age_ms": 0}
        body.update(changes)
        self.ctl.command(body)
        return self.ctl.state()["gesture"]["session"]

    def follow(self, session, **changes):
        body = {"action": "gesture_follow", "session": session, "seq": 1,
                "frame": 2, "age_ms": 0, "targets": {s: 1600 for s in self.ids}}
        body.update(changes)
        self.ctl.command(body)

    def test_start_never_enables_outputs(self):
        self.ids = ["S1"]
        with self.assertRaises(ValueError):
            self.start()
        self.assertEqual(self.pi.calls, [])

    def test_start_is_read_only_and_idle_lease_expires(self):
        self.enable()
        calls = list(self.pi.calls)
        self.start()
        time.sleep(.12)
        self.assertEqual(self.pi.calls, calls)
        self.idle()
        self.assertIsNone(self.ctl.state()["gesture"]["session"])
        self.assertEqual(self.pi.calls, calls)

    def test_pause_freezes_interpolation_and_preserves_grip(self):
        self.enable()
        session = self.start()
        self.follow(session)
        time.sleep(.06)
        self.ctl.command({"action": "gesture_pause", "session": session})
        position, calls = dict(self.pi.pulses), list(self.pi.calls)
        self.idle()
        self.assertEqual(self.pi.pulses, position)
        self.assertEqual(self.pi.calls, calls)
        self.assertTrue(all(1500 < pulse < 1600 for pulse in position.values()))

    def test_watchdog_freezes_before_target_and_never_resumes(self):
        self.enable()
        self.ctl.command({"action": "speed", "value": 125})
        session = self.start()
        self.follow(session)
        self.idle()
        position = dict(self.pi.pulses)
        self.assertTrue(all(1500 < pulse < 1600 for pulse in position.values()))
        with self.assertRaises(ValueError):
            self.follow(session, seq=2, frame=3)
        time.sleep(.05)
        self.assertEqual(self.pi.pulses, position)

    def test_old_messages_cannot_change_new_session(self):
        self.enable()
        first = self.start()
        self.ctl.command({"action": "gesture_pause", "session": first})
        self.idle()
        second = self.start(frame=10)
        self.ctl.command({"action": "gesture_pause", "session": first})
        with self.assertRaises(ValueError):
            self.follow(first, frame=11)
        self.assertEqual(self.ctl.state()["gesture"]["session"], second)
        self.follow(second, frame=11)

    def test_replayed_frame_invalidates_session_even_with_new_sequence(self):
        self.enable()
        session = self.start()
        self.follow(session)
        with self.assertRaises(ValueError):
            self.follow(session, seq=2)
        self.assertIsNone(self.ctl.state()["gesture"]["session"])
        self.idle()

    def test_invalid_updates_freeze_atomically(self):
        for changes in ({"targets": {"S1": 1550, "S5": 2000}},
                        {"targets": {"S1": 1550}}, {"age_ms": 251},
                        {"frame": float("nan")}, {"seq": True}):
            with self.subTest(changes=changes):
                self.enable()
                session = self.start()
                self.follow(session)
                with self.assertRaises(ValueError):
                    self.follow(session, **{"seq": 2, **changes})
                calls = list(self.pi.calls)
                self.idle()
                self.assertEqual(calls, self.pi.calls)

    def test_stop_invalidates_delayed_starts_and_follow(self):
        self.enable()
        old_epoch = self.ctl.control_epoch
        session = self.start()
        self.follow(session)
        self.ctl.command({"action": "stop"})
        self.assertTrue(all(p == 0 for p in self.pi.pulses.values()))
        self.enable()
        calls = list(self.pi.calls)
        with self.assertRaises(ValueError):
            self.start(epoch=old_epoch)
        with self.assertRaises(ValueError):
            self.follow(session, seq=2, frame=3)
        self.assertEqual(calls, self.pi.calls)

    def test_manual_follow_cannot_take_over_gestures(self):
        self.enable()
        self.start()
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "follow", "targets": {"S1": 1600}})
        with self.assertRaises(ValueError):
            self.ctl.command({"action": "move", "ids": ["S1"], "targets": {"S1": 1600}})

    def test_disable_pauses_others_and_cannot_be_undone_by_old_frames(self):
        self.enable()
        session = self.start()
        self.follow(session)
        time.sleep(.04)
        self.ctl.command({"action": "disable", "ids": ["S5"]})
        calls, base = list(self.pi.calls), self.pi.pulses[17]
        with self.assertRaises(ValueError):
            self.follow(session, frame=3, seq=2)
        self.idle()
        self.assertEqual(calls, self.pi.calls)
        self.assertEqual(self.pi.pulses[17], base)
        self.assertEqual(self.pi.pulses[24], 0)


if __name__ == "__main__":
    unittest.main()
