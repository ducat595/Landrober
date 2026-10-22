"""Offline checks. No JLR / Google calls and no real credentials."""
import asyncio
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

import probe


class ReaderTests(unittest.TestCase):
    def test_units_zero_and_unknown(self):
        values = probe.normalize({"ODOMETER_MILES": "100", "FUEL_LEVEL_PERC": "0",
                                  "DISTANCE_TO_EMPTY_FUEL": "640", "DOOR_IS_ALL_DOORS_LOCKED": "TRUE"})
        self.assertEqual(values, {"fuelPercent": 0, "rangeKm": 640, "odometerKm": 160.9, "lock": "locked"})
        self.assertTrue(all(probe.availability(values).values()))
        unknown = probe.normalize({"FUEL_LEVEL_PERC": "NaN", "ODOMETER_MILES": -1,
                                   "DISTANCE_TO_EMPTY_FUEL": "UNKNOWN", "DOOR_IS_ALL_DOORS_LOCKED": "UNKNOWN"})
        self.assertFalse(any(probe.availability(unknown).values()))
        self.assertIsNone(probe.normalize({"FUEL_LEVEL_PERC": True})["fuelPercent"])
        self.assertIsNone(probe.normalize({"FUEL_LEVEL_PERC": "101"})["fuelPercent"])

    def test_private_atomic_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "private" / "auth.json"
            probe.atomic_json(path, {"refreshToken": "test-only-one"})
            probe.atomic_json(path, {"refreshToken": "test-only-two"})
            self.assertEqual(json.loads(path.read_text())["refreshToken"], "test-only-two")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(list(path.parent.glob('.tmp-*')), [])


class SocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_collects_matching_vehicle_and_partial_messages_and_closes(self):
        closed = []
        class Telemetry:
            def __init__(self, session, client, **callbacks): self.cb = callbacks
            def async_set_vehicles(self, vins): self.vin = vins[0]
            async def async_start(self):
                self.cb['on_connected'](True)
                self.cb['on_status']('other', {'ODOMETER_MILES': '999'}, None)
                self.cb['on_status'](self.vin, {'ODOMETER_MILES': '100', 'FUEL_LEVEL_PERC': '0'}, 'broker-time')
                self.cb['on_status'](self.vin, {'DISTANCE_TO_EMPTY_FUEL': '640', 'DOOR_IS_ALL_DOORS_LOCKED': 'FALSE'}, None)
            async def async_stop(self): closed.append(True)
        with patch.object(probe, 'JlrTelemetry', Telemetry):
            status, connected, stamp, _ = await probe.read_once(None, None, 'mine', 0.1)
        self.assertEqual(status['ODOMETER_MILES'], '100')
        self.assertNotIn('LAST_UPDATED_TIME', status)
        self.assertEqual(probe.normalize(status)['lock'], 'unlocked')
        self.assertTrue(connected)
        self.assertTrue(stamp)
        self.assertEqual(closed, [True])

    async def test_timeout_is_bounded_and_always_closes(self):
        closed = []
        class Telemetry:
            def __init__(self, *args, **kwargs): pass
            def async_set_vehicles(self, vins): pass
            async def async_start(self): pass
            async def async_stop(self): closed.append(True)
        with patch.object(probe, 'JlrTelemetry', Telemetry):
            status, connected, stamp, _ = await probe.read_once(None, None, 'mine', 0.01)
        self.assertEqual(status, {})
        self.assertFalse(connected)
        self.assertIsNone(stamp)
        self.assertEqual(closed, [True])


if __name__ == '__main__':
    unittest.main()
