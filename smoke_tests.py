from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener


TEST_PORT = os.environ.get("JA_BLOOM362_TEST_PORT", "5177")
BASE_URL = os.environ.get("JA_BLOOM362_TEST_URL", f"http://127.0.0.1:{TEST_PORT}")


def request(opener, path: str, method: str = "GET", payload: dict | None = None, csrf: str | None = None):
    raw = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req = Request(BASE_URL + path, data=raw, headers=headers, method=method)
    try:
        with opener.open(req, timeout=10) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else {}
    except HTTPError as error:
        text = error.read().decode("utf-8")
        return error.code, json.loads(text) if text else {}


def request_raw(opener, path: str, method: str = "GET", payload: dict | None = None, csrf: str | None = None):
    raw = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req = Request(BASE_URL + path, data=raw, headers=headers, method=method)
    try:
        with opener.open(req, timeout=10) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def assert_status(label: str, actual: int, expected: int) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected}, got {actual}")


def login(email: str, password: str):
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    status, body = request(opener, "/api/login", "POST", {"login": email, "password": password})
    assert_status(f"login {email}", status, 200)
    return opener, body["user"]["csrfToken"], body["user"]


def wait_for_server(timeout: float = 8.0) -> bool:
    public = build_opener(HTTPCookieProcessor(CookieJar()))
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, _ = request(public, "/api/config")
            if status == 200:
                return True
        except URLError:
            pass
        time.sleep(0.25)
    return False


def ensure_server():
    if wait_for_server(0.5):
        return None
    env = {**os.environ, "JA_BLOOM362_PORT": TEST_PORT}
    process = subprocess.Popen(
        [sys.executable, "server.py"],
        cwd=os.path.dirname(__file__) or ".",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    if not wait_for_server(10):
        process.terminate()
        raise RuntimeError("JA Bloom362 server did not start")
    return process


def assert_no_cost(value: object) -> None:
    if isinstance(value, dict):
        if "cost" in value:
            raise AssertionError("manager received cost field")
        for item in value.values():
            assert_no_cost(item)
    elif isinstance(value, list):
        for item in value:
            assert_no_cost(item)


def main() -> None:
    server_process = ensure_server()
    try:
        public = build_opener(HTTPCookieProcessor(CookieJar()))
        status, config = request(public, "/api/config")
        assert_status("config", status, 200)

        stamp = int(time.time() * 1000)
        register_payload = {
            "storeName": f"Smoke Production Empty {stamp}",
            "owner": "Smoke Owner",
            "city": "РђРєС‚Р°Сѓ",
            "login": f"smoke{stamp}@ja-bloom362.kz",
            "password": "SmokeTest362!",
        }
        status, body = request(public, "/api/register", "POST", register_payload)
        assert_status("register empty store", status, 201)
        created_data = body["data"]
        for demo_key in ("inventory", "financeEntries", "leads"):
            if created_data.get(demo_key):
                raise AssertionError(f"new store received demo {demo_key}")

        owner, owner_csrf, _ = login("demo@ja-bloom362.kz", "FlowerLab362!")
        manager, manager_csrf, _ = login("manager@ja-bloom362.kz", "Manager362!")

        status, me = request(owner, "/api/me")
        assert_status("me", status, 200)
        assert me["user"]["role"] == "owner"

        status, _ = request(owner, "/api/backup", "POST")
        assert_status("csrf backup block", status, 403)

        status, courier_body = request(
            owner,
            "/api/users",
            "POST",
            {
                "name": f"Smoke Courier {stamp}",
                "login": f"courier{stamp}@ja-bloom362.kz",
                "password": "Courier362!",
                "role": "courier",
            },
            owner_csrf,
        )
        assert_status("create courier", status, 201)
        courier, courier_csrf, _ = login(courier_body["user"]["login"], "Courier362!")

        status, florist_body = request(
            owner,
            "/api/users",
            "POST",
            {
                "name": f"Smoke Florist {stamp}",
                "login": f"florist{stamp}@ja-bloom362.kz",
                "password": "Florist362!",
                "role": "florist",
            },
            owner_csrf,
        )
        assert_status("create florist", status, 201)
        florist, florist_csrf, _ = login(florist_body["user"]["login"], "Florist362!")

        status, backup = request(owner, "/api/backup", "POST", csrf=owner_csrf)
        assert_status("owner backup", status, 200)
        assert backup["backup"].startswith("ja_bloom362_")

        status, export_raw = request_raw(owner, "/api/export/json")
        assert_status("owner export json", status, 200)
        assert b"exportedAt" in export_raw

        status, item_body = request(
            owner,
            "/api/inventory",
            "POST",
            {"record": {"name": f"Smoke Roses {stamp}", "category": "Р¦РІРµС‚С‹", "qty": 5, "unit": "С€С‚", "cost": 100, "minQty": 1}},
            owner_csrf,
        )
        assert_status("inventory create", status, 201)
        item = item_body["record"]

        status, manager_data = request(manager, "/api/data")
        assert_status("manager data", status, 200)
        forbidden = {"financeEntries", "inventoryMoves", "cashShifts", "deleted", "auditLog", "settings"}
        leaked = forbidden.intersection(manager_data["data"].keys())
        if leaked:
            raise AssertionError(f"manager received forbidden sections: {sorted(leaked)}")
        assert manager_data["data"].get("inventory") is not None
        assert_no_cost(manager_data["data"])

        status, manager_inventory = request(manager, "/api/inventory")
        assert_status("manager safe inventory", status, 200)
        assert_no_cost(manager_inventory)
        if "inventoryMoves" in manager_inventory:
            raise AssertionError("manager received inventoryMoves")

        status, _ = request(manager, "/api/finance")
        assert_status("manager finance forbidden", status, 403)

        status, client_body = request(
            manager,
            "/api/clients",
            "POST",
            {
                "record": {
                    "name": f"Smoke Client {stamp}",
                    "phone": "+7 700 111 22 33",
                    "event": "2026-07-01",
                    "budget": 10000,
                }
            },
            manager_csrf,
        )
        assert_status("client create", status, 201)
        client = client_body["record"]

        order = {
            "clientId": client["id"],
            "date": "2026-06-23",
            "sum": 15000,
            "reason": "Smoke",
            "bouquet": "Smoke Bouquet",
            "status": "new",
            "deliveryDate": "2026-06-23",
            "items": [{"inventoryItemId": item["id"], "qty": 2}],
        }
        status, order_body = request(manager, "/api/orders", "POST", {"record": order}, manager_csrf)
        assert_status("manager order create with stock", status, 201)
        created_order = order_body["record"]
        assert_no_cost(order_body)

        status, owner_inventory = request(owner, "/api/inventory")
        assert_status("owner inventory after order", status, 200)
        updated_item = next(entry for entry in owner_inventory["inventory"] if int(entry["id"]) == int(item["id"]))
        if float(updated_item["qty"]) != 3:
            raise AssertionError(f"stock was not written off server-side, qty={updated_item['qty']}")

        status, _ = request(courier, f"/api/orders/{created_order['id']}", "DELETE", csrf=courier_csrf)
        assert_status("courier delete order forbidden", status, 403)

        status, _ = request(courier, "/api/orders", "POST", {"record": order}, courier_csrf)
        assert_status("courier create order forbidden", status, 403)

        status, florist_status = request(
            florist,
            f"/api/orders/{created_order['id']}",
            "PATCH",
            {"record": {"status": "ready"}},
            florist_csrf,
        )
        assert_status("florist ready status", status, 200)
        assert florist_status["record"]["status"] == "ready"

        status, _ = request(
            florist,
            f"/api/orders/{created_order['id']}",
            "PATCH",
            {"record": {"sum": 1}},
            florist_csrf,
        )
        assert_status("florist cannot edit amount", status, 403)

        status, courier_status = request(
            courier,
            "/api/delivery/status",
            "PATCH",
            {"orderId": created_order["id"], "status": "delivered"},
            courier_csrf,
        )
        assert_status("courier delivered status", status, 200)
        assert courier_status["record"]["status"] == "delivered"

        over_order = {**order, "items": [{"inventoryItemId": item["id"], "qty": 9999}]}
        status, body = request(manager, "/api/orders", "POST", {"record": over_order}, manager_csrf)
        assert_status("order insufficient stock blocked", status, 400)
        assert "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ" in body.get("error", "")

        print("JA Bloom362 smoke tests passed")
    finally:
        if server_process:
            server_process.terminate()
            try:
                server_process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server_process.kill()


if __name__ == "__main__":
    main()

