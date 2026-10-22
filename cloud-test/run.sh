#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip --disable-pip-version-check -q install -r requirements.txt
exec .venv/bin/python probe.py "$@"
