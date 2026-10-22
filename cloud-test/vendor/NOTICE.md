Source: https://github.com/willbeeching/ha-jlr-incontrol
Commit: 86fbc5a9dba2398cc2cb8b643bf1e2cf73bf78d6
Copyright (c) 2026 Will Beeching. MIT License: see LICENSE.

Included modules: api.py, auth.py, const.py, redact.py, telemetry.py.
Changes to auth.py: removed Home Assistant imports and the hass constructor
argument; created an owned aiohttp ClientSession with a 30-second request
timeout and trust_env=True; close that session instead of detaching it.
Some upstream comments still describe Home Assistant's session ownership.
No remote control functions are invoked by the test runner.
