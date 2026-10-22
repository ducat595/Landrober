#!/usr/bin/env python3
"""One-shot, read-only JLR connectivity test; no Google resources are created."""
from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
from getpass import getpass
import json
import logging
import math
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
import aiohttp
from jlr.api import JlrClient
from jlr.auth import JlrLogin
from jlr.telemetry import JlrTelemetry

STATE = Path(__file__).resolve().parent / ".state"
FIELDS = {
    "fuelPercent": "FUEL_LEVEL_PERC",
    "rangeKm": "DISTANCE_TO_EMPTY_FUEL",
    "odometerKm": "ODOMETER_MILES",
    "lock": "DOOR_IS_ALL_DOORS_LOCKED",
}


def atomic_json(path: Path, value: dict) -> None:
    """Persist rotating refresh tokens immediately, with private permissions."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def single_run():
    """Never let two processes spend the same single-use refresh token."""
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE, 0o700)
    with (STATE / "run.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("別の接続テストが実行中です。終了してから実行してください。") from None
        yield


def number(value, maximum=None):
    if isinstance(value, bool) or value is None:
        return None
    try:
        n = float(value)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(n) or n < 0 or (maximum is not None and n > maximum):
        return None
    return n


def normalize(status):
    miles = number(status.get("ODOMETER_MILES"))
    lock = str(status.get("DOOR_IS_ALL_DOORS_LOCKED", "")).upper()
    return {
        "fuelPercent": number(status.get("FUEL_LEVEL_PERC"), 100),
        "rangeKm": number(status.get("DISTANCE_TO_EMPTY_FUEL")),
        "odometerKm": round(miles * 1.609344, 1) if miles is not None else None,
        "lock": {"TRUE": "locked", "FALSE": "unlocked"}.get(lock),
    }


def availability(values):
    # Report presence only. A fuel value of zero is still a successful reading.
    return {name: values.get(name) is not None for name in FIELDS}


async def ask(prompt, hidden=False):
    return await asyncio.to_thread(getpass if hidden else input, prompt)


async def login():
    if not sys.stdin.isatty():
        raise RuntimeError("ログインには対話型ターミナルが必要です。Cloud Shellから実行してください。")
    username = (await ask("InControlのメールアドレス（非表示）: ", hidden=True)).strip()
    password = await ask("InControlのパスワード（非表示）: ", hidden=True)
    flow = JlrLogin(username)
    try:
        await flow.async_begin(password)
        password = None
        # Some accounts finish without requesting a code.
        needs_code = not (flow._callbacks or {}).get("tokenId")
        code = (await ask("メールの確認コード（非表示）: ", hidden=True)).strip() if needs_code else ""
        tokens = await flow.async_complete(code)
        print("ログイン成功")
        return username, tokens
    finally:
        password = None
        await flow.async_close()


async def read_once(client, session, vin, wait_seconds):
    status = {}
    received = asyncio.Event()
    connected = False
    received_at = None
    def on_status(message_vin, update, broker_time):
        nonlocal received_at
        if message_vin != vin:
            return
        status.update(update)
        received_at = datetime.now(timezone.utc).isoformat()
        # Broker delivery time does not establish freshness of the car's lock state.
        if all(availability(normalize(status)).values()):
            received.set()
    def on_connected(value):
        nonlocal connected
        connected = connected or value
    telemetry = JlrTelemetry(
        session, client, on_status=on_status,
        on_position=lambda *_: None, on_connected=on_connected,
    )
    telemetry.async_set_vehicles([vin])
    started = time.monotonic()
    try:
        await telemetry.async_start()
        try:
            await asyncio.wait_for(received.wait(), timeout=wait_seconds)
        except asyncio.TimeoutError:
            pass
    finally:
        await telemetry.async_stop()
    return status, connected, received_at, round(time.monotonic() - started, 1)


async def probe(args):
    auth_file = STATE / "auth.json"
    auth = json.loads(auth_file.read_text()) if auth_file.exists() else {}
    tokens = None
    if args.login or not auth.get("refreshToken"):
        username, tokens = await login()
        auth = {"username": username, "deviceId": str(uuid.uuid4()),
                "refreshToken": tokens.get("refresh_token")}
        atomic_json(auth_file, auth)
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=30), trust_env=True,
    ) as session:
        def persist():
            auth.update(refreshToken=client.refresh_token, userId=client.user_id,
                        deviceId=client.device_id)
            atomic_json(auth_file, auth)
        client = JlrClient(session, auth["username"], device_id=auth["deviceId"],
                           user_id=auth.get("userId"), refresh_token=auth.get("refreshToken"),
                           on_tokens=persist)
        if tokens:
            client.apply_tokens(tokens)
        vehicles = await client.async_get_vehicles()
        persist()
        vins = [v.get("vin") for v in vehicles if isinstance(v, dict) and v.get("vin")]
        if not vins:
            raise RuntimeError("ログインは成功しましたが、取得できる車両がありません。")
        print(f"車両一覧の取得成功（{len(vins)}台）")
        index = args.vehicle - 1
        if len(vins) > 1 and args.vehicle == 0:
            # VIN suffix only shown locally; never saved in the shareable report.
            for i, vin in enumerate(vins, 1):
                print(f"  {i}: 車台番号の末尾 {vin[-4:]}")
            selected = await ask("ディフェンダーの番号を入力: ")
            try:
                index = int(selected) - 1
            except ValueError:
                raise RuntimeError("車両番号は数字で指定してください。") from None
        elif args.vehicle == 0:
            index = 0
        if index < 0 or index >= len(vins):
            raise RuntimeError("指定された車両番号が一覧にありません。")
        print(f"車両データを最大{args.wait}秒待ちます…")
        status, connected, received_at, elapsed = await read_once(client, session, vins[index], args.wait)
        values = normalize(status)
        found = availability(values)
        report = {
            "result": "all_fields" if all(found.values()) else "partial" if any(found.values()) else "no_fields",
            "login": True, "vehicleList": True, "telemetryConnected": connected,
            "fields": found, "elapsedSeconds": elapsed,
            "vehicleTimestampPresent": bool(status.get("LAST_UPDATED_TIME")),
        }
        atomic_json(STATE / "snapshot.json", {
            **values, "receivedAt": received_at,
            "vehicleReportedAt": status.get("LAST_UPDATED_TIME"),
            "freshness": "unknown", "source": "unofficial-jlr-telemetry",
        })
        # Only boolean availability / elapsed time go to the shareable report.
        atomic_json(STATE / "report.json", report)
        print("\n--- 共有用の結果（ここから） ---")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        print("--- 共有用の結果（ここまで） ---")
        print("燃料・距離・ロックの実値は .state/snapshot.json に保存しました。共有不要です。")
        print("受信日時は車両状態の更新日時ではありません。ロック状態は最後に報告された値です。")
        return 0 if all(found.values()) else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--login", action="store_true", help="メール確認を含む再ログイン")
    parser.add_argument("--wait", type=int, default=45, help="受信待ち秒数、5〜120（既定45）")
    parser.add_argument("--vehicle", type=int, default=0, help="一覧の車両番号（1から）")
    args = parser.parse_args()
    if not 5 <= args.wait <= 120:
        parser.error("--wait は5〜120秒にしてください")
    if args.vehicle < 0:
        parser.error("--vehicle は0以上にしてください")
    os.umask(0o077)
    # No upstream bodies, URLs, IDs, or tokens are printed on login errors.
    logging.disable(logging.CRITICAL)
    try:
        with single_run():
            return asyncio.run(probe(args))
    except (KeyboardInterrupt, EOFError):
        print("\n中止しました。")
        return 130
    except Exception as error:
        code = type(error).__name__
        print(f"接続テスト未完了: {code}")
        if code == "JlrAuthError":
            print("再ログインが必要な可能性があります。bash run.sh --login を実行してください。")
        elif code in {"JlrInvalidCode", "JlrSessionExpired"}:
            print("確認コードが無効か期限切れです。bash run.sh --login で最初から試してください。")
        elif isinstance(error, RuntimeError):
            print(str(error))
        else:
            print("認証情報・通信先・APIの応答内容は表示していません。上のエラー名だけ共有してください。")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
