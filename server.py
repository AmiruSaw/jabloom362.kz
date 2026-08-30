from __future__ import annotations

import hashlib
import hmac
import csv
import io
import json
import logging
import os
import re
import secrets
import shutil
import sqlite3
try:
    import psycopg2
    import psycopg2.extras
    _PG_URL = os.environ.get("DATABASE_URL", "")
    USE_POSTGRES = bool(_PG_URL)
except ImportError:
    USE_POSTGRES = False
    _PG_URL = ""

import time
from datetime import date, datetime
from email.utils import formatdate
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
LEGACY_DB_PATH = ROOT / "bloom360.db"
DEFAULT_DB_PATH = ROOT / "ja_bloom362.db"
DB_PATH = Path(os.environ.get("JA_BLOOM362_DB_PATH", os.environ.get("BLOOM362_DB_PATH", str(DEFAULT_DB_PATH)))).resolve()
LOG_DIR = ROOT / "logs"
BACKUP_DIR = ROOT / "backups"
APP_ENV = os.environ.get("JA_BLOOM362_ENV", os.environ.get("BLOOM362_ENV", "development")).strip().lower()
IS_PRODUCTION = APP_ENV in {"prod", "production"}
COOKIE_NAME = os.environ.get("JA_BLOOM362_COOKIE_NAME", os.environ.get("BLOOM362_COOKIE_NAME", "ja_bloom362_session"))
APP_HOST = os.environ.get("JA_BLOOM362_HOST", os.environ.get("BLOOM362_HOST", "0.0.0.0"))
APP_PORT = int(os.environ.get("JA_BLOOM362_PORT", os.environ.get("BLOOM362_PORT", "5176")))
COOKIE_SECURE = os.environ.get("JA_BLOOM362_COOKIE_SECURE", os.environ.get("BLOOM362_COOKIE_SECURE", "1" if IS_PRODUCTION else "0")) == "1"
COOKIE_SAMESITE = os.environ.get("JA_BLOOM362_COOKIE_SAMESITE", os.environ.get("BLOOM362_COOKIE_SAMESITE", "Strict" if IS_PRODUCTION else "Lax"))
MAX_BODY_BYTES = 1_000_000
MAX_COLLECTION_ITEMS = 5_000
MAX_STRING_LENGTH = 1_200
MAX_LOGIN_ATTEMPTS = 8
LOGIN_WINDOW_SECONDS = 5 * 60
SESSION_TTL_SECONDS = int(os.environ.get("JA_BLOOM362_SESSION_DAYS", os.environ.get("BLOOM362_SESSION_DAYS", "14"))) * 24 * 60 * 60
ENABLE_DEMO_LOGIN = os.environ.get("JA_BLOOM362_ENABLE_DEMO_LOGIN", os.environ.get("BLOOM362_ENABLE_DEMO_LOGIN", "0" if IS_PRODUCTION else "1")) == "1"
ENABLE_DEMO_REGISTER = os.environ.get("JA_BLOOM362_ENABLE_DEMO_REGISTER", "0" if IS_PRODUCTION else "1") == "1"
SEED_DEMO_DATA = os.environ.get("JA_BLOOM362_SEED_DEMO", os.environ.get("BLOOM362_SEED_DEMO", "0" if IS_PRODUCTION else "1")) == "1"
BETA_INVITE_CODE = os.environ.get("JA_BLOOM362_BETA_INVITE_CODE", "").strip()
PUBLIC_FILES = {"index.html", "styles.css", "app.js", "courier.js", "courier-sw.js", "client-track.js"}
DEV_ALLOWED_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "null",
}
DEFAULT_ALLOWED_ORIGINS = set() if IS_PRODUCTION else DEV_ALLOWED_ORIGINS
ALLOWED_ORIGINS = DEFAULT_ALLOWED_ORIGINS | {
    origin.strip()
    for origin in os.environ.get("JA_BLOOM362_ALLOWED_ORIGINS", os.environ.get("BLOOM362_ALLOWED_ORIGINS", "")).split(",")
    if origin.strip()
}
sessions: dict[str, int] = {}
login_attempts: dict[str, list[float]] = {}
rate_attempts: dict[str, list[float]] = {}
courier_locations: dict[str, dict] = {}  # store_id -> {lat, lng, name, ts}
# token -> {store_id, order_id, type: "courier"|"client", expires}
delivery_tokens: dict[str, dict] = {}
DEMO_LOGIN_EMAILS = {
    "demo@ja-bloom362.kz",
    "manager@ja-bloom362.kz",
    "operator@ja-bloom362.kz",
    "florist@ja-bloom362.kz",
    "courier@ja-bloom362.kz",
    "rose@ja-bloom362.kz",
    "manager@rose362.kz",
}


LOG_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
LOGGER = logging.getLogger("ja_bloom362")
LOGGER.setLevel(logging.INFO)
if not LOGGER.handlers:
    handler = RotatingFileHandler(
        LOG_DIR / "ja_bloom362.log",
        maxBytes=2 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    LOGGER.addHandler(handler)


def default_store_settings(city: str = "Актау") -> dict:
    return {
        "city": city or "Актау",
        "currency": "₸",
        "bonusBasePercent": 5,
        "bonusVipPercent": 10,
        "lowStockAlert": True,
        "birthdayReminderDays": 7,
        "sleepyClientDays": 30,
    }


def empty_store_data(city: str = "Актау") -> dict:
    return {"clients": [], "orders": [], "settings": default_store_settings(city)}


DEMO_DATA = {
    "ja-bloom-aktau": {
        "clients": [
            {
                "id": 1,
                "name": "Ерлан Ахметов",
                "phone": "+7 777 123 45 67",
                "instagram": "@erlan.flowers",
                "address": "Актау, 14 микрорайон, 12",
                "recipient": "Айгерим",
                "relation": "Жена",
                "flowers": "Пионы, белые розы",
                "eventOffset": 34,
                "budget": 25000,
                "bonus": 3250,
                "orders": 14,
                "lastOrderOffset": -12,
                "channel": "WhatsApp",
                "status": "VIP",
            },
            {
                "id": 2,
                "name": "Алия Нур",
                "phone": "+7 701 555 22 11",
                "instagram": "@aliya.nur",
                "address": "Актау, 17 микрорайон, 6",
                "recipient": "Мама",
                "relation": "Мама",
                "flowers": "Розы, эустома",
                "eventOffset": 7,
                "budget": 18000,
                "bonus": 900,
                "orders": 5,
                "lastOrderOffset": -19,
                "channel": "Instagram",
                "status": "Постоянный",
            },
            {
                "id": 3,
                "name": "Максим Ким",
                "phone": "+7 705 888 44 21",
                "instagram": "",
                "address": "Актау, 5 микрорайон, 22",
                "recipient": "Ольга",
                "relation": "Девушка",
                "flowers": "Тюльпаны",
                "eventOffset": 52,
                "budget": 15000,
                "bonus": 750,
                "orders": 2,
                "lastOrderOffset": -84,
                "channel": "2GIS",
                "status": "Спящий",
            },
            {
                "id": 4,
                "name": "Данияр С.",
                "phone": "+7 707 221 09 09",
                "instagram": "@office.flowers",
                "address": "Актау, 29А микрорайон, 18",
                "recipient": "Корпоратив",
                "relation": "Офис",
                "flowers": "Композиции",
                "eventOffset": 14,
                "budget": 45000,
                "bonus": 4200,
                "orders": 11,
                "lastOrderOffset": -3,
                "channel": "WhatsApp",
                "status": "VIP",
            },
        ],
        "orders": [
            {"id": 1, "clientId": 1, "dateOffset": -12, "sum": 25000, "reason": "Годовщина", "bouquet": "Пионы Premium", "channel": "WhatsApp"},
            {"id": 2, "clientId": 4, "dateOffset": -3, "sum": 42000, "reason": "Офис", "bouquet": "Композиция Lux", "channel": "WhatsApp"},
            {"id": 3, "clientId": 2, "dateOffset": -19, "sum": 18000, "reason": "День рождения", "bouquet": "Розы Mix", "channel": "Instagram"},
            {"id": 4, "clientId": 3, "dateOffset": -84, "sum": 15000, "reason": "Свидание", "bouquet": "Тюльпаны", "channel": "2GIS"},
        ],
        "inventory": [
            {"id": 1, "name": "Розы белые", "category": "Цветы", "qty": 200, "unit": "шт", "cost": 400, "price": 800, "minQty": 30},
            {"id": 2, "name": "Розы красные", "category": "Цветы", "qty": 150, "unit": "шт", "cost": 400, "price": 800, "minQty": 30},
            {"id": 3, "name": "Розы розовые", "category": "Цветы", "qty": 100, "unit": "шт", "cost": 380, "price": 750, "minQty": 20},
            {"id": 4, "name": "Эустома", "category": "Цветы", "qty": 80, "unit": "шт", "cost": 300, "price": 600, "minQty": 15},
            {"id": 5, "name": "Пионы", "category": "Цветы", "qty": 60, "unit": "шт", "cost": 700, "price": 1400, "minQty": 10},
            {"id": 6, "name": "Тюльпаны", "category": "Цветы", "qty": 120, "unit": "шт", "cost": 250, "price": 500, "minQty": 25},
            {"id": 7, "name": "Хризантемы", "category": "Цветы", "qty": 90, "unit": "шт", "cost": 200, "price": 400, "minQty": 20},
            {"id": 8, "name": "Упаковочная бумага", "category": "Упаковка", "qty": 500, "unit": "шт", "cost": 50, "price": 100, "minQty": 50},
            {"id": 9, "name": "Лента атласная", "category": "Упаковка", "qty": 300, "unit": "м", "cost": 30, "price": 60, "minQty": 50},
            {"id": 10, "name": "Коробка цветочная", "category": "Упаковка", "qty": 80, "unit": "шт", "cost": 300, "price": 500, "minQty": 10},
        ],
        "inventoryMoves": [],
    },
    "rose-studio-aktau": {
        "clients": [
            {
                "id": 101,
                "name": "Сауле Ермек",
                "phone": "+7 702 333 44 55",
                "instagram": "@saule.home",
                "address": "Актау, 12 микрорайон, 44",
                "recipient": "Дочь",
                "relation": "Дочь",
                "flowers": "Кустовые розы, гипсофила",
                "eventOffset": 11,
                "budget": 17000,
                "bonus": 850,
                "orders": 4,
                "lastOrderOffset": -18,
                "channel": "Instagram",
                "status": "Постоянный",
            },
            {
                "id": 102,
                "name": "Нурлан Б.",
                "phone": "+7 747 120 90 10",
                "instagram": "",
                "address": "Актау, набережная, 7",
                "recipient": "Супруга",
                "relation": "Жена",
                "flowers": "Красные розы",
                "eventOffset": 3,
                "budget": 30000,
                "bonus": 2100,
                "orders": 9,
                "lastOrderOffset": -72,
                "channel": "WhatsApp",
                "status": "Спящий",
            },
        ],
        "orders": [
            {"id": 101, "clientId": 101, "dateOffset": -18, "sum": 17000, "reason": "День рождения", "bouquet": "Розы Mini", "channel": "Instagram"},
            {"id": 102, "clientId": 102, "dateOffset": -72, "sum": 30000, "reason": "Годовщина", "bouquet": "Red Rose Premium", "channel": "WhatsApp"},
        ],
    },
}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$", 1)
    candidate = hash_password(password, bytes.fromhex(salt_hex)).split("$", 1)[1]
    return hmac.compare_digest(candidate, digest_hex)


def strong_password(password: str) -> bool:
    return (
        len(password) >= 10
        and re.search(r"[a-zа-я]", password)
        and re.search(r"[A-ZА-Я]", password)
        and re.search(r"\d", password)
        and re.search(r"[^A-Za-zА-Яа-я0-9]", password)
    )


def ensure_database_path() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DB_PATH == DEFAULT_DB_PATH and not DB_PATH.exists() and LEGACY_DB_PATH.exists():
        shutil.copy2(LEGACY_DB_PATH, DB_PATH)


def connect():
    if USE_POSTGRES:
        conn = psycopg2.connect(_PG_URL, cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = False
        return conn
    ensure_database_path()
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _q(sql: str) -> str:
    """Convert SQLite ? placeholders to PostgreSQL %s if needed."""
    if USE_POSTGRES:
        return sql.replace("?", "%s")
    return sql


def _exec(db, sql: str, params=()):
    """Execute query with correct placeholder style."""
    if USE_POSTGRES:
        cur = db.cursor()
        cur.execute(_q(sql), params)
        return cur
    return _exec(db, sql, params)


def _execmany(db, sql: str, params_list):
    if USE_POSTGRES:
        cur = db.cursor()
        cur.executemany(_q(sql), params_list)
        return cur
    return db.executemany(sql, params_list)


def _fetchone(cur_or_row):
    if USE_POSTGRES:
        row = cur_or_row.fetchone()
        return row
    return cur_or_row.fetchone()


def _fetchall(cur_or_row):
    if USE_POSTGRES:
        return cur_or_row.fetchall()
    return cur_or_row.fetchall()


def _lastrowid(db, cur) -> int:
    if USE_POSTGRES:
        cur2 = db.cursor()
        cur2.execute("SELECT lastval()")
        return cur2.fetchone()["lastval"]
    return cur.lastrowid


def init_db() -> None:
    with connect() as db:
        if USE_POSTGRES:
            cur = db.cursor()
            cur.execute("""
                create table if not exists stores (
                    id serial primary key,
                    store_id text unique not null,
                    store_name text not null,
                    owner text not null,
                    city text not null,
                    plan text not null,
                    data_json text not null
                )
            """)
            cur.execute("""
                create table if not exists users (
                    id serial primary key,
                    store_id integer not null references stores(id),
                    login text unique not null,
                    password_hash text not null,
                    name text not null default \'\',
                    role text not null default \'owner\'
                )
            """)
            cur.execute("""
                create table if not exists sessions (
                    token text primary key,
                    user_id integer not null references users(id),
                    created_at real not null,
                    expires_at real not null,
                    csrf_token text not null default \'\'
                )
            """)
            db.commit()
        else:
            db.executescript(
                """
                create table if not exists stores (
                    id integer primary key autoincrement,
                    store_id text unique not null,
                    store_name text not null,
                    owner text not null,
                    city text not null,
                    plan text not null,
                    data_json text not null
                );

                create table if not exists users (
                    id integer primary key autoincrement,
                    store_id integer not null references stores(id),
                    login text unique not null,
                    password_hash text not null
                );

                create table if not exists sessions (
                    token text primary key,
                    user_id integer not null references users(id),
                    created_at real not null,
                    expires_at real not null
                );

                create table if not exists delivery_tokens (
                    token text primary key,
                    store_id text not null,
                    order_id text not null,
                    type text not null,
                    expires real not null
                );

                create table if not exists courier_locs (
                    key text primary key,
                    lat real not null,
                    lng real not null,
                    acc integer not null default 0,
                    ts real not null
                );
                """
            )
        ensure_column(db, "users", "name", "text not null default ''")
        ensure_column(db, "users", "role", "text not null default 'owner'")
        ensure_column(db, "sessions", "csrf_token", "text not null default ''")
        for row in _exec(db, "select token from sessions where csrf_token = '' or csrf_token is null").fetchall():
            _exec(db, "update sessions set csrf_token = ? where token = ?", (secrets.token_urlsafe(32), row["token"]))
        _exec(db, "update users set role = 'owner' where role = '' or role is null")
        _exec(db, "update users set name = (select owner from stores where stores.id = users.store_id) where name = '' or name is null")

        if SEED_DEMO_DATA:
            seed_store(db, "ja-bloom-aktau", "JA Bloom Aktau", "Алина, владелец", "Актау", "Beta", "demo@ja-bloom362.kz", "FlowerLab362!")
            seed_store(db, "rose-studio-aktau", "Rose Studio Aktau", "Мадина, владелец", "Актау", "Beta", "rose@ja-bloom362.kz", "RoseStudio362!")
            seed_user(db, "ja-bloom-aktau", "manager@ja-bloom362.kz", "Manager362!", "Менеджер JA Bloom", "manager")
            seed_user(db, "ja-bloom-aktau", "operator@ja-bloom362.kz", "Operator362!", "Оператор JA Bloom", "operator")
            seed_user(db, "ja-bloom-aktau", "florist@ja-bloom362.kz", "Florist362!", "Флорист JA Bloom", "florist")
            seed_user(db, "ja-bloom-aktau", "courier@ja-bloom362.kz", "Courier362!", "Курьер JA Bloom", "courier")
            seed_user(db, "rose-studio-aktau", "manager@rose362.kz", "Manager362!", "Менеджер Rose", "manager")
        _exec(db, "delete from sessions where expires_at <= ?", (time.time(),))


def ensure_column(db, table: str, column: str, definition: str) -> None:
    if USE_POSTGRES:
        cur = db.cursor()
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = %s AND column_name = %s
        """, (table, column))
        if not cur.fetchone():
            cur.execute(f"alter table {table} add column {column} {definition}")
    else:
        columns = {row["name"] for row in _exec(db, f"pragma table_info({table})")}
        if column not in columns:
            _exec(db, f"alter table {table} add column {column} {definition}")


def materialize_dates(seed: dict) -> dict:
    from datetime import date, timedelta

    today = date.today()
    data = empty_store_data("Актау")
    for client in seed["clients"]:
        item = dict(client)
        item["event"] = (today + timedelta(days=item.pop("eventOffset"))).isoformat()
        item["lastOrder"] = (today + timedelta(days=item.pop("lastOrderOffset"))).isoformat()
        data["clients"].append(item)
    for order in seed["orders"]:
        item = dict(order)
        item["date"] = (today + timedelta(days=item.pop("dateOffset"))).isoformat()
        data["orders"].append(item)
    return data


def seed_store(db: sqlite3.Connection, store_id: str, store_name: str, owner: str, city: str, plan: str, login: str, password: str) -> None:
    existing = _exec(db, "select id from stores where store_id = ?", (store_id,)).fetchone()
    if existing:
        return

    cursor = _exec(db, 
        "insert into stores (store_id, store_name, owner, city, plan, data_json) values (?, ?, ?, ?, ?, ?)",
        (store_id, store_name, owner, city, plan, json.dumps(materialize_dates(DEMO_DATA[store_id]), ensure_ascii=False)),
    )
    _exec(db, 
        "insert into users (store_id, login, password_hash, name, role) values (?, ?, ?, ?, ?)",
        (_lastrowid(db, cursor), login.lower(), hash_password(password), owner, "owner"),
    )


def seed_user(db: sqlite3.Connection, store_id: str, login: str, password: str, name: str, role: str) -> None:
    if _exec(db, "select 1 from users where login = ?", (login.lower(),)).fetchone():
        return
    store = _exec(db, "select id from stores where store_id = ?", (store_id,)).fetchone()
    if not store:
        return
    _exec(db, 
        "insert into users (store_id, login, password_hash, name, role) values (?, ?, ?, ?, ?)",
        (store["id"], login.lower(), hash_password(password), name, role),
    )


def make_store_id(db: sqlite3.Connection, store_name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", store_name.lower()).strip("-")
    if not base:
        base = "store"
    candidate = base
    index = 2
    while _exec(db, "select 1 from stores where store_id = ?", (candidate,)).fetchone():
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def login_key(ip: str, login: str) -> str:
    return f"{ip}:{login.lower()}"


def is_rate_limited(ip: str, login: str) -> bool:
    now = time.time()
    key = login_key(ip, login)
    attempts = [stamp for stamp in login_attempts.get(key, []) if now - stamp < LOGIN_WINDOW_SECONDS]
    login_attempts[key] = attempts
    return len(attempts) >= MAX_LOGIN_ATTEMPTS


def record_login_failure(ip: str, login: str) -> None:
    now = time.time()
    key = login_key(ip, login)
    attempts = [stamp for stamp in login_attempts.get(key, []) if now - stamp < LOGIN_WINDOW_SECONDS]
    attempts.append(now)
    login_attempts[key] = attempts


def clear_login_failures(ip: str, login: str) -> None:
    login_attempts.pop(login_key(ip, login), None)


def is_limited(scope: str, ip: str, limit: int, window_seconds: int) -> bool:
    now = time.time()
    key = f"{scope}:{ip}"
    attempts = [stamp for stamp in rate_attempts.get(key, []) if now - stamp < window_seconds]
    attempts.append(now)
    rate_attempts[key] = attempts
    return len(attempts) > limit


def clean_text(value: object, limit: int = MAX_STRING_LENGTH) -> str:
    return re.sub(r"[<>\"'`\x00-\x1f\x7f]", "", str(value or ""))[:limit].strip()


def clean_url(value: object) -> str:
    raw = clean_text(value, 600)
    if not raw:
        return ""
    parsed = urlparse(raw)
    return raw if parsed.scheme in {"http", "https", "tel", "mailto"} else ""


def sanitize_crm_value(value: object, key: str = "") -> object:
    if isinstance(value, str):
        lower_key = key.lower()
        return clean_url(value) if "url" in lower_key or lower_key == "photo" else clean_text(value)
    if isinstance(value, list):
        if len(value) > MAX_COLLECTION_ITEMS:
            raise ValueError("Too many records in CRM data")
        return [sanitize_crm_value(item) for item in value]
    if isinstance(value, dict):
        return {clean_text(name, 80): sanitize_crm_value(item, name) for name, item in value.items()}
    return value


def validate_crm_data(data: object) -> dict:
    if not isinstance(data, dict) or "clients" not in data or "orders" not in data:
        raise ValueError("Некорректные данные")
    for collection_name in ("clients", "orders", "leads", "financeEntries", "inventory", "inventoryMoves", "cashShifts"):
        collection = data.get(collection_name, [])
        if collection is not None and not isinstance(collection, list):
            raise ValueError(f"Некорректный раздел данных: {collection_name}")
        if isinstance(collection, list) and len(collection) > MAX_COLLECTION_ITEMS:
            raise ValueError(f"Слишком много записей: {collection_name}")
    return sanitize_crm_value(data)


def valid_date_string(value: object, required: bool = False) -> bool:
    if value in (None, ""):
        return not required
    try:
        date.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def clean_number(value: object, field: str, minimum: float = 0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"Некорректное число: {field}")
    if number < minimum:
        raise ValueError(f"{field} не может быть меньше {minimum}")
    return number


def validate_client_record(record: dict, partial: bool = False) -> dict:
    item = sanitize_crm_value(record)
    if not isinstance(item, dict):
        raise ValueError("Некорректный клиент")
    if not partial or "name" in item:
        if not clean_text(item.get("name"), 180):
            raise ValueError("Укажите имя клиента")
    if not partial or "phone" in item:
        if not clean_text(item.get("phone"), 80):
            raise ValueError("Укажите телефон клиента")
    if not partial or "budget" in item:
        item["budget"] = int(clean_number(item.get("budget"), "budget"))
    if not partial or "event" in item:
        if not valid_date_string(item.get("event"), required=True):
            raise ValueError("Некорректная дата события")
    elif "event" in item and not valid_date_string(item.get("event")):
        raise ValueError("Некорректная дата события")
    if "lastOrder" in item and not valid_date_string(item.get("lastOrder")):
        raise ValueError("Некорректная дата последнего заказа")
    return item


def validate_lead_record(record: dict, partial: bool = False) -> dict:
    item = sanitize_crm_value(record)
    if not isinstance(item, dict):
        raise ValueError("Некорректный лид")
    if not partial or "name" in item:
        if not clean_text(item.get("name"), 180):
            raise ValueError("Укажите имя потенциального клиента")
    if "budget" in item:
        item["budget"] = int(clean_number(item.get("budget"), "budget"))
    if "status" in item and item["status"] not in {"new", "wrote", "negotiation", "order", "lost"}:
        raise ValueError("Некорректный статус лида")
    return item


def validate_inventory_record(record: dict, partial: bool = False) -> dict:
    item = sanitize_crm_value(record)
    if not isinstance(item, dict):
        raise ValueError("Некорректная складская позиция")
    if not partial or "name" in item:
        if not clean_text(item.get("name"), 180):
            raise ValueError("Укажите название складской позиции")
    for key in ("qty", "cost", "minQty"):
        if key in item:
            item[key] = clean_number(item.get(key), key)
    return item


def validate_finance_record(record: dict, partial: bool = False) -> dict:
    item = sanitize_crm_value(record)
    if not isinstance(item, dict):
        raise ValueError("Некорректная финансовая запись")
    if not partial or "amount" in item:
        item["amount"] = int(clean_number(item.get("amount"), "amount"))
    if not partial or "type" in item:
        if item.get("type") not in {"revenue", "expense"}:
            raise ValueError("Тип финансовой записи должен быть revenue или expense")
    if not partial or "date" in item:
        if not valid_date_string(item.get("date"), required=True):
            raise ValueError("Некорректная дата финансовой записи")
    if not partial or "category" in item:
        if not clean_text(item.get("category"), 180):
            raise ValueError("Укажите категорию финансовой записи")
    return item


def find_record(records: list[dict], record_id: object) -> dict | None:
    try:
        wanted = int(record_id)
    except (TypeError, ValueError):
        return None
    return next((item for item in records if int(item.get("id", 0)) == wanted), None)


def normalize_order_items(data: dict, items: object) -> list[dict]:
    if items in (None, ""):
        return []
    if not isinstance(items, list):
        raise ValueError("Состав заказа должен быть списком")
    normalized = []
    inventory = data.get("inventory", [])
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Некорректная строка состава заказа")
        inventory_item_id = int(item.get("inventoryItemId") or item.get("itemId") or 0)
        qty = clean_number(item.get("qty"), "qty", 0.0001)
        stock = find_record(inventory, inventory_item_id)
        if not stock:
            raise ValueError("Складская позиция в заказе не найдена")
        normalized.append(
            {
                "inventoryItemId": inventory_item_id,
                "itemName": clean_text(item.get("itemName") or stock.get("name"), 180),
                "qty": qty,
                "unit": clean_text(item.get("unit") or stock.get("unit") or "шт", 40),
                "cost": clean_number(stock.get("cost", 0), "cost"),
            }
        )
    return normalized


def validate_order_record(data: dict, record: dict, partial: bool = False) -> dict:
    item = sanitize_crm_value(record)
    if not isinstance(item, dict):
        raise ValueError("Некорректный заказ")
    if not partial or "clientId" in item:
        if not find_record(data.get("clients", []), item.get("clientId")):
            raise ValueError("Клиент заказа не найден")
        item["clientId"] = int(item["clientId"])
    if not partial or "sum" in item:
        item["sum"] = int(clean_number(item.get("sum"), "sum"))
    if not partial or "date" in item:
        if not valid_date_string(item.get("date"), required=True):
            raise ValueError("Некорректная дата заказа")
    if not partial or "deliveryDate" in item:
        if not valid_date_string(item.get("deliveryDate"), required=True):
            raise ValueError("Некорректная дата доставки")
    if not partial or "status" in item:
        item.setdefault("status", "new")
        if item["status"] not in {"new", "work", "ready", "delivered", "cancelled"}:
            raise ValueError("Некорректный статус заказа")
    if not partial or "items" in item:
        item["items"] = normalize_order_items(data, item.get("items"))
    return item


def cashback_rate(data: dict, client: dict) -> float:
    settings = data.get("settings", {})
    base = number_like(settings.get("bonusBasePercent", 5)) / 100
    vip = number_like(settings.get("bonusVipPercent", 10)) / 100
    orders = number_like(client.get("orders", 0))
    if orders >= 10:
        return vip
    if orders >= 5:
        return (base + vip) / 2
    return base


def refresh_client_last_order(data: dict, client_id: object) -> None:
    client = find_record(data.get("clients", []), client_id)
    if not client:
        return
    dates = [
        str(order.get("date"))
        for order in data.get("orders", [])
        if int(order.get("clientId", 0)) == int(client_id) and order.get("status") != "cancelled" and order.get("date")
    ]
    client["lastOrder"] = sorted(dates)[-1] if dates else "1900-01-01"


def apply_order_impact(data: dict, order: dict, direction: int) -> None:
    client = find_record(data.get("clients", []), order.get("clientId"))
    if not client:
        return
    bonus = int(order.get("bonus") or round(number_like(order.get("sum")) * cashback_rate(data, client)))
    client["orders"] = max(0, int(number_like(client.get("orders"))) + direction)
    client["bonus"] = max(0, int(number_like(client.get("bonus"))) + direction * bonus)
    if direction > 0 and order.get("date"):
        client["lastOrder"] = order.get("date")
    else:
        refresh_client_last_order(data, order.get("clientId"))


def stock_available_with_restore(data: dict, item_id: int, restore_order: dict | None = None) -> float:
    stock = find_record(data.get("inventory", []), item_id)
    available = number_like(stock.get("qty")) if stock else 0
    if restore_order:
        for item in restore_order.get("items", []) or []:
            if int(item.get("inventoryItemId", 0)) == item_id:
                available += number_like(item.get("qty"))
    return available


def validate_order_stock(data: dict, items: list[dict], restore_order: dict | None = None) -> None:
    for item in items:
        item_id = int(item.get("inventoryItemId", 0))
        if number_like(item.get("qty")) > stock_available_with_restore(data, item_id, restore_order):
            stock = find_record(data.get("inventory", []), item_id)
            name = stock.get("name") if stock else item.get("itemName")
            raise ValueError(f"Недостаточно на складе: {name}")


def apply_inventory_for_order(data: dict, order: dict, direction: int, reason: str, user: sqlite3.Row) -> None:
    data.setdefault("inventoryMoves", [])
    for item in order.get("items", []) or []:
        stock = find_record(data.get("inventory", []), item.get("inventoryItemId"))
        if not stock:
            continue
        qty = number_like(item.get("qty"))
        stock["qty"] = max(0, number_like(stock.get("qty")) + direction * qty)
        data["inventoryMoves"].insert(
            0,
            {
                "id": int(time.time() * 1000) + len(data["inventoryMoves"]),
                "type": "writeoff" if direction < 0 else "receipt",
                "itemId": stock.get("id"),
                "itemName": stock.get("name"),
                "qty": qty,
                "unit": stock.get("unit", "шт"),
                "reason": reason,
                "date": date.today().isoformat(),
                "user": user["login"],
            },
        )


def add_backend_audit(data: dict, user: sqlite3.Row, action: str, entity_type: str, entity_id: object = "", message: str = "") -> None:
    data.setdefault("auditLog", [])
    data["auditLog"].insert(
        0,
        {
            "id": int(time.time() * 1000),
            "createdAt": datetime.now().isoformat(),
            "userId": int(user["user_id"]),
            "userRole": user["role"],
            "user": user["login"],
            "action": action,
            "entityType": entity_type,
            "entityId": str(entity_id or ""),
            "message": clean_text(message, 500),
        },
    )
    data["auditLog"] = data["auditLog"][:500]


API_COLLECTIONS = {
    "/api/clients": ("clients", "clients", False),
    "/api/orders": ("orders", "orders", False),
    "/api/leads": ("leads", "leads", False),
    "/api/inventory": ("inventory", "inventory", False),
    "/api/finance": ("financeEntries", "financeEntries", True),
}
COLLECTION_BY_NAME = {value[0]: {"path": path, "response": value[1], "owner_only": value[2]} for path, value in API_COLLECTIONS.items()}
ENTITY_PATHS = {
    "clients": ("clients", "clients", False),
    "orders": ("orders", "orders", False),
    "leads": ("leads", "leads", False),
    "inventory": ("inventory", "inventory", True),
    "finance": ("financeEntries", "financeEntries", True),
}
ROLE_WRITE_ACCESS = {
    "clients": {"owner", "manager", "operator"},
    "orders": {"owner", "manager", "operator"},
    "leads": {"owner", "manager", "operator"},
    "inventory": {"owner"},
    "financeEntries": {"owner"},
}
ROLE_READ_ACCESS = {
    "clients": {"owner", "manager", "operator"},
    "orders": {"owner", "manager", "operator", "florist", "courier"},
    "leads": {"owner", "manager", "operator"},
    "inventory": {"owner", "manager", "operator"},
    "financeEntries": {"owner"},
}
MANAGER_LIKE_ROLES = {"manager", "operator"}
ORDER_STATUS_BY_ROLE = {
    "owner": {"new", "work", "ready", "delivered", "cancelled"},
    "manager": {"new", "work", "ready", "delivered", "cancelled"},
    "operator": {"new", "work", "ready", "delivered", "cancelled"},
    "florist": {"work", "ready"},
    "courier": {"delivered"},
}
FILTERED_ROLE_KEYS = {"financeEntries", "inventoryMoves", "cashShifts", "deleted", "auditLog", "settings"}


def load_store_data(user: sqlite3.Row) -> dict:
    try:
        data = json.loads(user["data_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        data = empty_store_data(user["city"] if "city" in user.keys() else "Актау")
    if not isinstance(data, dict):
        data = empty_store_data(user["city"] if "city" in user.keys() else "Актау")
    data.setdefault("clients", [])
    data.setdefault("orders", [])
    settings = data.get("settings")
    if not isinstance(settings, dict):
        settings = {}
    data["settings"] = {**default_store_settings(user["city"] if "city" in user.keys() else "Актау"), **settings}
    return data


def safe_inventory_items(data: dict) -> list[dict]:
    return [
        {
            "id": item.get("id"),
            "name": item.get("name", ""),
            "qty": item.get("qty", 0),
            "unit": item.get("unit", "шт"),
        }
        for item in data.get("inventory", [])
        if isinstance(item, dict)
    ]


def strip_order_costs(orders: list[dict]) -> list[dict]:
    clean_orders = json.loads(json.dumps(orders, ensure_ascii=False))
    for order in clean_orders:
        for item in order.get("items", []) or []:
            if isinstance(item, dict):
                item.pop("cost", None)
    return clean_orders


def order_visible_to_role(user: sqlite3.Row, order: dict) -> bool:
    role = user["role"]
    if role in {"owner", "manager", "operator", "florist"}:
        return True
    if role == "courier":
        return bool(order.get("deliveryDate")) and order.get("status") != "cancelled"
    return False


def filter_orders_for_role(user: sqlite3.Row, orders: list[dict]) -> list[dict]:
    visible = [order for order in orders if isinstance(order, dict) and order_visible_to_role(user, order)]
    return visible if user["role"] == "owner" else strip_order_costs(visible)


def safe_clients_for_role(user: sqlite3.Row, data: dict) -> list[dict]:
    if user["role"] in {"owner", "manager", "operator"}:
        return data.get("clients", [])
    order_client_ids = {int(order.get("clientId", 0)) for order in filter_orders_for_role(user, data.get("orders", []))}
    safe_clients = []
    for client in data.get("clients", []):
        try:
            client_id = int(client.get("id", 0))
        except (TypeError, ValueError):
            continue
        if client_id in order_client_ids:
            safe_clients.append(
                {
                    "id": client.get("id"),
                    "name": client.get("name", ""),
                    "phone": client.get("phone", ""),
                    "address": client.get("address", ""),
                }
            )
    return safe_clients


def collection_for_role(user: sqlite3.Row, data: dict, collection_name: str) -> list[dict]:
    if collection_name == "orders":
        return filter_orders_for_role(user, data.get("orders", []))
    if collection_name == "inventory":
        return data.get("inventory", []) if user["role"] == "owner" else safe_inventory_items(data)
    if collection_name == "clients":
        return safe_clients_for_role(user, data)
    if collection_name == "leads":
        return data.get("leads", []) if user["role"] in {"owner", "manager", "operator"} else []
    if collection_name == "financeEntries":
        return data.get("financeEntries", []) if user["role"] == "owner" else []
    return data.get(collection_name, [])


def filter_data_for_role(user: sqlite3.Row, data: dict) -> dict:
    if user["role"] == "owner":
        return json.loads(json.dumps(data, ensure_ascii=False))
    filtered = {
        "clients": safe_clients_for_role(user, data),
        "orders": filter_orders_for_role(user, data.get("orders", [])),
        "returnTasks": data.get("returnTasks", []) if user["role"] in {"manager", "operator"} else [],
    }
    if user["role"] in MANAGER_LIKE_ROLES:
        filtered["leads"] = data.get("leads", [])
        filtered["inventory"] = safe_inventory_items(data)
    elif user["role"] in {"florist", "courier"}:
        filtered["leads"] = []
        filtered["inventory"] = []
    for key in FILTERED_ROLE_KEYS:
        filtered.pop(key, None)
    return filtered


def save_store_data(user: sqlite3.Row, data: dict) -> dict:
    clean_data = validate_crm_data(data)
    with connect() as db:
        _exec(db, 
            "update stores set data_json = ? where id = ?",
            (json.dumps(clean_data, ensure_ascii=False), user["store_row_id"]),
        )
    return clean_data


def next_record_id(records: list[object]) -> int:
    ids = []
    for record in records:
        if isinstance(record, dict):
            try:
                ids.append(int(record.get("id", 0)))
            except (TypeError, ValueError):
                continue
    return max(ids, default=0) + 1


def number_like(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


SENSITIVE_DATA_KEYS = {"financeEntries", "inventory", "inventoryMoves", "cashShifts", "settings", "deleted"}


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def forbidden_data_sections_for_role(user: sqlite3.Row, old_data: dict, new_data: dict) -> list[str]:
    if user["role"] == "owner":
        return []
    blocked = []
    for key in SENSITIVE_DATA_KEYS:
        if canonical_json(old_data.get(key)) != canonical_json(new_data.get(key)):
            blocked.append(key)
    return blocked


def require_owner_role(handler: "BloomHandler", user: sqlite3.Row) -> bool:
    if user["role"] != "owner":
        handler.json_response({"error": "Доступ только для владельца"}, HTTPStatus.FORBIDDEN)
        return False
    return True


def can_write_collection(user: sqlite3.Row, collection_name: str) -> bool:
    return user["role"] in ROLE_WRITE_ACCESS.get(collection_name, {"owner"})


def can_read_collection(user: sqlite3.Row, collection_name: str) -> bool:
    return user["role"] in ROLE_READ_ACCESS.get(collection_name, {"owner"})


def parse_entity_path(path: str) -> tuple[str, str, bool, int] | None:
    parts = [part for part in path.strip("/").split("/") if part]
    if len(parts) != 3 or parts[0] != "api":
        return None
    entity = parts[1]
    if entity not in ENTITY_PATHS:
        return None
    try:
        record_id = int(parts[2])
    except ValueError:
        return None
    collection_name, response_key, owner_only = ENTITY_PATHS[entity]
    return collection_name, response_key, owner_only, record_id


def parse_inventory_move_path(path: str) -> int | None:
    parts = [part for part in path.strip("/").split("/") if part]
    if len(parts) != 4 or parts[:2] != ["api", "inventory"] or parts[3] != "move":
        return None
    try:
        return int(parts[2])
    except ValueError:
        return None


def validate_record_for_collection(data: dict, collection_name: str, record: dict, partial: bool = False) -> dict:
    if collection_name == "clients":
        return validate_client_record(record, partial)
    if collection_name == "orders":
        return validate_order_record(data, record, partial)
    if collection_name == "leads":
        return validate_lead_record(record, partial)
    if collection_name == "inventory":
        return validate_inventory_record(record, partial)
    if collection_name == "financeEntries":
        return validate_finance_record(record, partial)
    raise ValueError("Неизвестный раздел данных")


def invite_code_ok(value: object) -> bool:
    if not BETA_INVITE_CODE:
        return True
    return hmac.compare_digest(str(value or "").strip(), BETA_INVITE_CODE)


def create_backup(reason: str = "manual") -> Path:
    ensure_database_path()
    if not DB_PATH.exists():
        raise FileNotFoundError("База данных еще не создана")
    safe_reason = re.sub(r"[^a-zA-Z0-9_-]+", "-", clean_text(reason, 40)).strip("-").lower() or "manual"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = BACKUP_DIR / f"ja_bloom362_{stamp}_{safe_reason}.db"
    shutil.copy2(DB_PATH, target)
    backups = sorted(BACKUP_DIR.glob("ja_bloom362_*.db"), key=lambda item: item.stat().st_mtime, reverse=True)
    for old_backup in backups[20:]:
        old_backup.unlink(missing_ok=True)
    return target


def rows_to_csv(rows: list[dict]) -> bytes:
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    if not fieldnames:
        fieldnames = ["empty"]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, "") for key in fieldnames})
    return output.getvalue().encode("utf-8-sig")


def response_payload_for_collection(user: sqlite3.Row, data: dict, response_key: str, collection_name: str, record: dict | None = None) -> dict:
    payload = {
        response_key: collection_for_role(user, data, collection_name),
        "data": filter_data_for_role(user, data),
    }
    if record is not None:
        payload["record"] = strip_order_costs([record])[0] if collection_name == "orders" and user["role"] != "owner" else record
    return payload


def create_entity(user: sqlite3.Row, collection_name: str, response_key: str, record: dict) -> tuple[dict, dict]:
    if not can_write_collection(user, collection_name):
        raise PermissionError("Недостаточно прав для изменения этого раздела")
    data = load_store_data(user)
    collection = data.setdefault(collection_name, [])
    if len(collection) >= MAX_COLLECTION_ITEMS:
        raise ValueError("Слишком много записей в разделе")
    clean_record = validate_record_for_collection(data, collection_name, record, partial=False)
    clean_record.setdefault("id", next_record_id(collection))
    if collection_name == "orders":
        clean_record.setdefault("items", [])
        clean_record["items"] = normalize_order_items(data, clean_record.get("items", []))
        validate_order_stock(data, clean_record["items"])
        client = find_record(data.get("clients", []), clean_record["clientId"])
        clean_record["bonus"] = int(round(number_like(clean_record.get("sum")) * cashback_rate(data, client or {})))
        collection.insert(0, clean_record)
        apply_inventory_for_order(data, clean_record, -1, "Списание по заказу", user)
        apply_order_impact(data, clean_record, 1)
    else:
        collection.insert(0, clean_record)
    add_backend_audit(data, user, "create", collection_name, clean_record.get("id"), clean_record.get("name") or clean_record.get("bouquet") or clean_record.get("category") or "")
    save_store_data(user, data)
    return clean_record, data


def patch_entity(user: sqlite3.Row, collection_name: str, response_key: str, record_id: int, patch: dict) -> tuple[dict, dict]:
    if not can_write_collection(user, collection_name):
        raise PermissionError("Недостаточно прав для изменения этого раздела")
    data = load_store_data(user)
    collection = data.setdefault(collection_name, [])
    existing = find_record(collection, record_id)
    if not existing:
        raise LookupError("Запись не найдена")
    clean_patch = validate_record_for_collection(data, collection_name, patch, partial=True)
    if collection_name == "orders":
        previous_order = json.loads(json.dumps(existing, ensure_ascii=False))
        draft = {**existing, **clean_patch, "id": existing["id"]}
        draft = validate_order_record(data, draft, partial=False)
        draft.setdefault("items", [])
        draft["items"] = normalize_order_items(data, draft.get("items", []))
        apply_order_impact(data, previous_order, -1)
        apply_inventory_for_order(data, previous_order, 1, "Коррекция заказа", user)
        try:
            validate_order_stock(data, draft["items"])
        except ValueError:
            apply_inventory_for_order(data, previous_order, -1, "Откат коррекции заказа", user)
            apply_order_impact(data, previous_order, 1)
            raise
        existing.clear()
        existing.update(draft)
        client = find_record(data.get("clients", []), existing["clientId"])
        existing["bonus"] = int(round(number_like(existing.get("sum")) * cashback_rate(data, client or {})))
        apply_inventory_for_order(data, existing, -1, "Списание по заказу", user)
        apply_order_impact(data, existing, 1)
    else:
        existing.update(clean_patch)
    add_backend_audit(data, user, "update", collection_name, record_id, existing.get("name") or existing.get("bouquet") or existing.get("category") or "")
    save_store_data(user, data)
    return existing, data


def delete_entity(user: sqlite3.Row, collection_name: str, response_key: str, record_id: int) -> tuple[dict, dict]:
    if not can_write_collection(user, collection_name):
        raise PermissionError("Недостаточно прав для удаления в этом разделе")
    data = load_store_data(user)
    collection = data.setdefault(collection_name, [])
    existing = find_record(collection, record_id)
    if not existing:
        raise LookupError("Запись не найдена")
    data.setdefault("deleted", {"clients": [], "orders": []})
    if collection_name == "clients":
        related_orders = [order for order in data.get("orders", []) if int(order.get("clientId", 0)) == record_id]
        data["deleted"].setdefault("clients", []).insert(
            0,
            {
                "deletedId": int(time.time() * 1000),
                "deletedAt": datetime.now().isoformat(),
                "deletedBy": user["login"],
                "reason": "Удаление клиента через API",
                "client": existing,
                "orders": related_orders,
            },
        )
        for order in related_orders:
            apply_inventory_for_order(data, order, 1, "Удаление клиента", user)
        data["orders"] = [order for order in data.get("orders", []) if int(order.get("clientId", 0)) != record_id]
    elif collection_name == "orders":
        data["deleted"].setdefault("orders", []).insert(
            0,
            {
                "deletedId": int(time.time() * 1000),
                "deletedAt": datetime.now().isoformat(),
                "deletedBy": user["login"],
                "reason": "Удаление заказа через API",
                "order": existing,
            },
        )
        apply_inventory_for_order(data, existing, 1, "Удаление заказа", user)
        apply_order_impact(data, existing, -1)
    collection.remove(existing)
    add_backend_audit(data, user, "delete", collection_name, record_id, existing.get("name") or existing.get("bouquet") or existing.get("category") or "")
    save_store_data(user, data)
    return existing, data


def patch_order_status(user: sqlite3.Row, record_id: int, status: str) -> tuple[dict, dict]:
    status = clean_text(status, 40)
    allowed = ORDER_STATUS_BY_ROLE.get(user["role"], set())
    if status not in allowed:
        raise PermissionError("Недостаточно прав для такого статуса заказа")
    data = load_store_data(user)
    order = find_record(data.get("orders", []), record_id)
    if not order:
        raise LookupError("Заказ не найден")
    if not order_visible_to_role(user, order):
        raise PermissionError("Заказ недоступен для этой роли")
    order["status"] = status
    add_backend_audit(data, user, "status", "orders", record_id, f"Статус заказа: {status}")
    save_store_data(user, data)
    return order, data


def restore_deleted_item(user: sqlite3.Row, restore_type: str, deleted_id: object) -> tuple[dict, dict]:
    if user["role"] != "owner":
        raise PermissionError("Доступ только для владельца")
    data = load_store_data(user)
    deleted = data.setdefault("deleted", {"clients": [], "orders": []})
    record_id = int(deleted_id)
    if restore_type == "client":
        collection = deleted.setdefault("clients", [])
        item = next((entry for entry in collection if int(entry.get("deletedId", 0)) == record_id), None)
        if not item:
            raise LookupError("Удаленный клиент не найден")
        for order in item.get("orders", []) or []:
            validate_order_stock(data, order.get("items", []))
        client = item.get("client")
        if isinstance(client, dict) and not find_record(data.setdefault("clients", []), client.get("id")):
            data["clients"].insert(0, client)
        for order in item.get("orders", []) or []:
            if isinstance(order, dict) and not find_record(data.setdefault("orders", []), order.get("id")):
                data["orders"].insert(0, order)
                apply_inventory_for_order(data, order, -1, "Восстановление клиента", user)
                apply_order_impact(data, order, 1)
        collection.remove(item)
        add_backend_audit(data, user, "restore", "client", record_id, client.get("name", "") if isinstance(client, dict) else "")
        save_store_data(user, data)
        return item, data
    if restore_type == "order":
        collection = deleted.setdefault("orders", [])
        item = next((entry for entry in collection if int(entry.get("deletedId", 0)) == record_id), None)
        if not item:
            raise LookupError("Удаленный заказ не найден")
        order = item.get("order")
        if not isinstance(order, dict):
            raise ValueError("Некорректный удаленный заказ")
        validate_order_stock(data, order.get("items", []))
        if not find_record(data.setdefault("orders", []), order.get("id")):
            data["orders"].insert(0, order)
            apply_inventory_for_order(data, order, -1, "Восстановление заказа", user)
            apply_order_impact(data, order, 1)
        collection.remove(item)
        add_backend_audit(data, user, "restore", "order", record_id, order.get("bouquet", ""))
        save_store_data(user, data)
        return item, data
    raise ValueError("Некорректный тип восстановления")


def move_inventory_item(user: sqlite3.Row, item_id: int, move_type: str, qty: object, reason: object = "") -> tuple[dict, dict]:
    if user["role"] != "owner":
        raise PermissionError("Доступ только для владельца")
    if move_type not in {"receipt", "writeoff"}:
        raise ValueError("Некорректный тип движения склада")
    amount = clean_number(qty, "qty", 0.0001)
    data = load_store_data(user)
    item = find_record(data.setdefault("inventory", []), item_id)
    if not item:
        raise LookupError("Складская позиция не найдена")
    if move_type == "writeoff" and amount > number_like(item.get("qty")):
        raise ValueError("Нельзя списать больше текущего остатка")
    item["qty"] = number_like(item.get("qty")) + amount if move_type == "receipt" else number_like(item.get("qty")) - amount
    data.setdefault("inventoryMoves", []).insert(
        0,
        {
            "id": int(time.time() * 1000),
            "type": move_type,
            "itemId": item.get("id"),
            "itemName": item.get("name"),
            "qty": amount,
            "unit": item.get("unit", "шт"),
            "reason": clean_text(reason, 300),
            "date": date.today().isoformat(),
            "user": user["login"],
        },
    )
    add_backend_audit(data, user, move_type, "inventory", item_id, f"{item.get('name')} · {amount} {item.get('unit', 'шт')}")
    save_store_data(user, data)
    return item, data


class BloomHandler(SimpleHTTPRequestHandler):
    def send_security_headers(self) -> None:
        csp = (
            "default-src 'self'; "
            "script-src 'self' https://cdnjs.cloudflare.com; "
            "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
            "img-src 'self' https: data:; "
            "connect-src 'self' https://*.tile.openstreetmap.org; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        self.send_header("Content-Security-Policy", csp)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        if COOKIE_SECURE:
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

    def end_headers(self) -> None:
        self.send_security_headers()
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
            self.send_header("Vary", "Origin")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        requested = unquote(path.split("?", 1)[0].split("#", 1)[0]).replace("\\", "/").lstrip("/")
        requested = requested or "index.html"
        if "/" in requested or requested not in PUBLIC_FILES:
            return str(ROOT / "__not_found__")
        target = (ROOT / requested).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            return str(ROOT / "__not_found__")
        return str(target)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            self.handle_api_get()
            return
        if self.path.startswith("/track/"):
            self.handle_track_page()
            return
        if self.path == "/track-sw.js":
            self.handle_sw()
            return
        super().do_GET()

    def handle_track_page(self) -> None:
        token = self.path.split("/track/")[-1].split("?")[0].strip("/")
        with connect() as db:
            row = _exec(db, "select * from delivery_tokens where token=?", (token,)).fetchone()
        info = dict(row) if row else None
        if not info or time.time() > info.get("expires", 0):
            self.html_response("<h2>Ссылка недействительна или устарела</h2>", HTTPStatus.NOT_FOUND)
            return
        page_type = info["type"]  # "courier" or "client"
        order_id = info["order_id"]
        store_id = info["store_id"]
        if page_type == "courier":
            html = self.build_courier_page(token, order_id)
        else:
            html = self.build_client_page(token, order_id, store_id)
        self.html_response(html)

    def html_response(self, html: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        raw = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Content-Security-Policy",
            "default-src 'self' 'unsafe-inline'; "
            "script-src 'unsafe-inline' 'self'; "
            "style-src 'unsafe-inline' 'self'; "
            "img-src * data: blob:; "
            "connect-src * 'self';"
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # Вызываем super напрямую — минуем end_headers который добавит второй CSP
        from http.server import BaseHTTPRequestHandler
        BaseHTTPRequestHandler.end_headers(self)
        self.wfile.write(raw)

    def handle_sw(self) -> None:
        """Отдаём Service Worker скрипт для фонового трекинга"""
        sw_code = r"""
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'START') {
    self.trackToken = e.data.token;
    self.trackActive = true;
    self.trackInterval = setInterval(sendLocation, 12000);
  }
  if (e.data && e.data.type === 'STOP') {
    self.trackActive = false;
    clearInterval(self.trackInterval);
  }
});

function sendLocation() {
  if (!self.trackActive || !self.trackToken) return;
  // SW не имеет доступа к GPS — он только держит воркер живым
  // Реальную отправку делает страница через postMessage обратно
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'PING' }));
  });
}
""".strip()
        raw = sw_code.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Service-Worker-Allowed", "/track/")
        self.end_headers()
        self.wfile.write(raw)

    def build_courier_page(self, token: str, order_id: str) -> str:
        page = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Трекинг курьера</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:14px}
h1{font-size:22px;text-align:center}
.sub{color:#888;font-size:14px;text-align:center;max-width:300px;line-height:1.5}
#btn{background:#27ae60;color:#fff;border:none;border-radius:16px;padding:20px 0;font-size:19px;font-weight:700;width:100%;max-width:320px;cursor:pointer;-webkit-tap-highlight-color:transparent}
#btn.stop{background:#e74c3c}
.badge{display:inline-flex;align-items:center;gap:8px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;padding:7px 18px;font-size:13px}
.dot{width:10px;height:10px;border-radius:50%;background:#444;transition:background .3s}
.dot.green{background:#27ae60;animation:pulse 1.2s infinite}
.dot.red{background:#e74c3c}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
#status{font-size:13px;color:#777;text-align:center;min-height:18px}
#log{width:100%;max-width:320px;background:#1a1a1a;border-radius:10px;padding:12px;font-size:11px;color:#888;min-height:60px;white-space:pre-wrap;word-break:break-all}
.warn{background:#1e1400;border:1px solid #5a3a00;border-radius:10px;padding:12px;font-size:12px;color:#c8941a;max-width:320px;text-align:center;display:none}
</style>
</head>
<body>
<h1>🛵 Режим курьера</h1>
<p class="sub">Нажми кнопку — местоположение будет передаваться каждые 10 секунд.</p>
<div class="badge"><span class="dot" id="dot"></span><span id="badgeText">Ожидание</span></div>
<button id="btn" type="button">📡 Начать трекинг</button>
<div id="status"></div>
<div class="warn" id="bgWarn">⚠️ Оставь экран включённым для стабильного трекинга.</div>
<div id="log">Загрузка скрипта...</div>
<script>window.COURIER_TOKEN = "TOKEN_PLACEHOLDER";</script>
<script src="/courier.js"></script>
</body></html>"""
        page = page.replace("TOKEN_PLACEHOLDER", token)
        return page
    def build_client_page(self, token: str, order_id: str, store_id: str) -> str:
        page = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Отслеживание доставки</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#111;color:#fff}
#header{padding:14px 18px;background:#1a1a1a;border-bottom:1px solid #2a2a2a;position:fixed;top:0;left:0;right:0;z-index:1000}
#header h1{font-size:18px;margin-bottom:4px}
#status{font-size:13px;color:#27ae60;display:flex;align-items:center;gap:6px}
#map{position:fixed;top:0;left:0;right:0;bottom:64px;margin-top:64px}
#info{position:fixed;bottom:0;left:0;right:0;height:64px;padding:10px 18px;background:#1a1a1a;border-top:1px solid #2a2a2a;z-index:1000}
#distText{font-size:15px;font-weight:600}
#infoText{font-size:12px;color:#888;margin-top:2px}
.dot{width:9px;height:9px;border-radius:50%;background:#27ae60;flex-shrink:0;animation:pulse 1.2s infinite;display:inline-block}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<div id="header">
  <h1>🛵 Курьер едет к вам</h1>
  <div id="status"><span class="dot"></span><span>Поиск курьера...</span></div>
</div>
<div id="map"></div>
<div id="info">
  <div id="distText">Ожидаем курьера</div>
  <div id="infoText">Страница обновляется каждые 8 секунд</div>
</div>
<script>window.CLIENT_TOKEN = "TOKEN_PLACEHOLDER";</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script src="/client-track.js"></script>
</body></html>"""
        page = page.replace("TOKEN_PLACEHOLDER", token)
        return page
    def do_POST(self) -> None:
        try:
            self.handle_api_post()
        except PermissionError as error:
            self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
        except LookupError as error:
            self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
        except ValueError as error:
            status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE if "too large" in str(error) else HTTPStatus.BAD_REQUEST
            self.json_response({"error": str(error)}, status)
        except json.JSONDecodeError:
            self.json_response({"error": "Некорректный JSON"}, HTTPStatus.BAD_REQUEST)

    def do_PUT(self) -> None:
        try:
            self.handle_api_put()
        except PermissionError as error:
            self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
        except LookupError as error:
            self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
        except ValueError as error:
            status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE if "too large" in str(error) else HTTPStatus.BAD_REQUEST
            self.json_response({"error": str(error)}, status)
        except json.JSONDecodeError:
            self.json_response({"error": "Некорректный JSON"}, HTTPStatus.BAD_REQUEST)

    def do_PATCH(self) -> None:
        try:
            self.handle_api_patch()
        except PermissionError as error:
            self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
        except LookupError as error:
            self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
        except ValueError as error:
            status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE if "too large" in str(error) else HTTPStatus.BAD_REQUEST
            self.json_response({"error": str(error)}, status)
        except json.JSONDecodeError:
            self.json_response({"error": "Некорректный JSON"}, HTTPStatus.BAD_REQUEST)

    def do_DELETE(self) -> None:
        try:
            self.handle_api_delete()
        except PermissionError as error:
            self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
        except LookupError as error:
            self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
        except ValueError as error:
            status = HTTPStatus.REQUEST_ENTITY_TOO_LARGE if "too large" in str(error) else HTTPStatus.BAD_REQUEST
            self.json_response({"error": str(error)}, status)
        except json.JSONDecodeError:
            self.json_response({"error": "Некорректный JSON"}, HTTPStatus.BAD_REQUEST)

    def handle_api_get(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/courier/locations":
            user = self.require_user()
            if not user:
                return
            store_id = str(user["store_id"])
            locs = [v for k, v in courier_locations.items() if k.startswith(store_id + ":")]
            self.json_response({"locations": locs})
            return

        if path == "/api/track/status":
            # Публичный — без авторизации
            from urllib.parse import parse_qs
            parsed2 = urlparse(self.path)
            params = parse_qs(parsed2.query)
            token = (params.get("token") or [""])[0]
            with connect() as db:
                row = _exec(db, "select * from delivery_tokens where token=?", (token,)).fetchone()
                info = dict(row) if row else None
            if not info or time.time() > info.get("expires", 0):
                self.json_response({"error": "Токен недействителен"}, HTTPStatus.NOT_FOUND)
                return
            loc_key = "track:" + str(info["store_id"]) + ":" + str(info["order_id"])
            with connect() as db:
                loc_row = _exec(db, "select * from courier_locs where key=?", (loc_key,)).fetchone()
            loc = dict(loc_row) if loc_row else {}
            self.json_response({"lat": loc.get("lat"), "lng": loc.get("lng"), "acc": loc.get("acc"), "ts": loc.get("ts")})
            return

        if path == "/api/config":
            self.json_response(
                {
                    "appEnv": APP_ENV,
                    "isDevelopment": not IS_PRODUCTION,
                    "demoLoginEnabled": ENABLE_DEMO_LOGIN,
                    "demoRegisterEnabled": ENABLE_DEMO_REGISTER,
                    "betaInviteRequired": bool(BETA_INVITE_CODE),
                }
            )
            return

        if path == "/api/demo-login":
            if not ENABLE_DEMO_LOGIN:
                self.redirect_response("/?login_error=demo_disabled")
                return
            login = parse_qs(parsed.query).get("login", [""])[0].strip().lower()
            user = self.user_by_login(login) if login in DEMO_LOGIN_EMAILS else None
            if not user:
                self.redirect_response("/?login_error=1")
                return
            session_cookie, _ = self.start_session(user)
            self.redirect_response("/", headers={"Set-Cookie": session_cookie})
            return

        if path == "/api/me":
            user = self.current_user()
            if not user:
                self.json_response({"user": None}, HTTPStatus.UNAUTHORIZED)
                return
            self.json_response({"user": self.public_user(user)})
            return

        if path == "/api/data":
            user = self.require_user()
            if not user:
                return
            self.json_response({"data": filter_data_for_role(user, load_store_data(user))})
            return

        if path in API_COLLECTIONS:
            user = self.require_user()
            if not user:
                return
            collection_name, response_key, owner_only = API_COLLECTIONS[path]
            if owner_only and not require_owner_role(self, user):
                return
            if not can_read_collection(user, collection_name):
                self.json_response({"error": "Недостаточно прав для просмотра этого раздела"}, HTTPStatus.FORBIDDEN)
                return
            data = load_store_data(user)
            payload = {response_key: collection_for_role(user, data, collection_name)}
            if path == "/api/inventory" and user["role"] == "owner":
                payload["inventoryMoves"] = data.get("inventoryMoves", [])
            if path == "/api/finance":
                payload["cashShifts"] = data.get("cashShifts", [])
            self.json_response(payload)
            return

        if path == "/api/settings":
            user = self.require_user()
            if not user:
                return
            if not require_owner_role(self, user):
                return
            self.json_response({"settings": load_store_data(user).get("settings", default_store_settings(user["city"]))})
            return

        if path in {"/api/export/clients.csv", "/api/export/orders.csv"}:
            user = self.require_user()
            if not user:
                return
            if not require_owner_role(self, user):
                return
            data = load_store_data(user)
            collection_name = "clients" if path.endswith("clients.csv") else "orders"
            filename = f"ja-bloom362-{collection_name}-{datetime.now().strftime('%Y-%m-%d')}.csv"
            self.bytes_response(rows_to_csv(data.get(collection_name, [])), "text/csv; charset=utf-8", filename)
            return

        if path == "/api/export/json":
            user = self.require_user()
            if not user:
                return
            if not require_owner_role(self, user):
                return
            payload = {
                "exportedAt": datetime.now().isoformat(),
                "store": self.public_user(user, ""),
                "data": load_store_data(user),
            }
            raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            filename = f"ja-bloom362-{user['store_id']}-{datetime.now().strftime('%Y-%m-%d')}.json"
            self.bytes_response(raw, "application/json; charset=utf-8", filename)
            return

        if path == "/api/users":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "owner":
                self.json_response({"error": "Доступ только для владельца"}, HTTPStatus.FORBIDDEN)
                return
            with connect() as db:
                rows = _exec(db, 
                    "select id, login, name, role from users where store_id = ? order by role desc, id",
                    (user["store_row_id"],),
                ).fetchall()
            self.json_response({"users": [dict(row) for row in rows]})
            return

        self.json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def handle_api_post(self) -> None:
        path = urlparse(self.path).path
        csrf_exempt_paths = {"/api/login", "/api/register", "/api/form-login", "/api/form-register"}
        if path not in csrf_exempt_paths and not self.verify_csrf():
            return

        if path == "/api/form-login":
            if is_limited("form-login", self.client_ip(), 10, 10 * 60):
                self.redirect_response("/?login_error=rate")
                return
            body = self.read_form()
            login = str(body.get("login", "")).strip().lower()
            password = str(body.get("password", ""))
            if is_rate_limited(self.client_ip(), login):
                self.redirect_response("/?login_error=rate")
                return
            user = self.user_by_login(login)
            if not user or not verify_password(password, user["password_hash"]):
                record_login_failure(self.client_ip(), login)
                self.redirect_response("/?login_error=1")
                return
            clear_login_failures(self.client_ip(), login)
            session_cookie, _ = self.start_session(user)
            self.redirect_response("/", headers={"Set-Cookie": session_cookie})
            return

        if path == "/api/form-register":
            if is_limited("form-register", self.client_ip(), 5, 30 * 60):
                self.redirect_response("/?register_error=rate")
                return
            body = self.read_form()
            store_name = str(body.get("storeName", "")).strip()
            owner = str(body.get("owner", "")).strip()
            city = str(body.get("city", "")).strip()
            login = str(body.get("login", "")).strip().lower()
            password = str(body.get("password", ""))
            password_confirm = str(body.get("passwordConfirm", ""))
            invite_code = str(body.get("inviteCode", ""))

            if not store_name or not owner or not city or not login or not password:
                self.redirect_response("/?register_error=fields")
                return
            if not invite_code_ok(invite_code):
                self.redirect_response("/?register_error=invite")
                return
            if "@" not in login or "." not in login:
                self.redirect_response("/?register_error=email")
                return
            if not strong_password(password) or password != password_confirm:
                self.redirect_response("/?register_error=password")
                return

            with connect() as db:
                existing_user = _exec(db, "select 1 from users where login = ?", (login,)).fetchone()
                if existing_user:
                    self.redirect_response("/?register_error=exists")
                    return

                store_id = make_store_id(db, store_name)
                initial_data = empty_store_data(city)
                cursor = _exec(db, 
                    "insert into stores (store_id, store_name, owner, city, plan, data_json) values (?, ?, ?, ?, ?, ?)",
                    (store_id, store_name, owner, city, "Trial", json.dumps(initial_data, ensure_ascii=False)),
                )
                user_cursor = _exec(db, 
                    "insert into users (store_id, login, password_hash, name, role) values (?, ?, ?, ?, ?)",
                    (_lastrowid(db, cursor), login, hash_password(password), owner, "owner"),
                )
                db.commit()
                user = _exec(db, 
                    """
                    select users.id user_id, users.login, users.password_hash, users.name, users.role,
                           stores.id store_row_id, stores.store_id, stores.store_name,
                           stores.owner, stores.city, stores.plan, stores.data_json
                    from users
                    join stores on stores.id = users.store_id
                    where users.id = ?
                    """,
                    (_lastrowid(db, user_cursor),),
                ).fetchone()

            session_cookie, _ = self.start_session(user)
            self.redirect_response("/", headers={"Set-Cookie": session_cookie})
            return

        if path == "/api/register":
            if is_limited("register", self.client_ip(), 5, 30 * 60):
                self.json_response({"error": "Слишком много регистраций. Попробуйте позже."}, HTTPStatus.TOO_MANY_REQUESTS)
                return
            body = self.read_json()
            store_name = str(body.get("storeName", "")).strip()
            owner = str(body.get("owner", "")).strip()
            city = str(body.get("city", "")).strip()
            login = str(body.get("login", "")).strip().lower()
            password = str(body.get("password", ""))
            invite_code = str(body.get("inviteCode", ""))
            is_demo_register = bool(body.get("demoRegister"))

            if not store_name or not owner or not city or not login or not password:
                self.json_response({"error": "Заполните все поля"}, HTTPStatus.BAD_REQUEST)
                return
            if is_demo_register and not ENABLE_DEMO_REGISTER:
                self.json_response({"error": "Тестовая регистрация отключена"}, HTTPStatus.FORBIDDEN)
                return
            if not invite_code_ok(invite_code):
                self.json_response({"error": "Неверный beta invite code"}, HTTPStatus.FORBIDDEN)
                return
            if "@" not in login or "." not in login:
                self.json_response({"error": "Введите корректный email"}, HTTPStatus.BAD_REQUEST)
                return
            if not strong_password(password):
                self.json_response({"error": "Пароль должен быть минимум 10 символов, с большой и маленькой буквой, цифрой и спецсимволом"}, HTTPStatus.BAD_REQUEST)
                return

            with connect() as db:
                existing_user = _exec(db, "select 1 from users where login = ?", (login,)).fetchone()
                if existing_user:
                    self.json_response({"error": "Такой email уже зарегистрирован"}, HTTPStatus.CONFLICT)
                    return

                store_id = make_store_id(db, store_name)
                initial_data = empty_store_data(city)
                cursor = _exec(db, 
                    "insert into stores (store_id, store_name, owner, city, plan, data_json) values (?, ?, ?, ?, ?, ?)",
                    (store_id, store_name, owner, city, "Trial", json.dumps(initial_data, ensure_ascii=False)),
                )
                user_cursor = _exec(db, 
                    "insert into users (store_id, login, password_hash, name, role) values (?, ?, ?, ?, ?)",
                    (_lastrowid(db, cursor), login, hash_password(password), owner, "owner"),
                )
                db.commit()
                user = _exec(db, 
                    """
                    select users.id user_id, users.login, users.name, users.role,
                           stores.id store_row_id, stores.store_id, stores.store_name,
                           stores.owner, stores.city, stores.plan, stores.data_json
                    from users
                    join stores on stores.id = users.store_id
                    where users.id = ?
                    """,
                    (_lastrowid(db, user_cursor),),
                ).fetchone()

            session_cookie, csrf_token = self.start_session(user)
            self.json_response({"user": self.public_user(user, csrf_token), "data": initial_data}, HTTPStatus.CREATED, headers={"Set-Cookie": session_cookie})
            return

        if path == "/api/login":
            if is_limited("login", self.client_ip(), 10, 10 * 60):
                self.json_response({"error": "Слишком много попыток входа. Попробуйте через 10 минут."}, HTTPStatus.TOO_MANY_REQUESTS)
                return
            body = self.read_json()
            login = str(body.get("login", "")).strip().lower()
            password = str(body.get("password", ""))
            login_ip = self.client_ip()
            if IS_PRODUCTION and login in DEMO_LOGIN_EMAILS:
                self.json_response({"error": "Демо-аккаунты отключены в production"}, HTTPStatus.FORBIDDEN)
                return
            if is_rate_limited(self.client_ip(), login):
                self.json_response({"error": "Слишком много попыток входа. Попробуйте через 5 минут."}, HTTPStatus.TOO_MANY_REQUESTS)
                return
            with connect() as db:
                user = _exec(db, 
                    """
                    select users.id user_id, users.login, users.password_hash, users.name, users.role,
                           stores.id store_row_id, stores.store_id, stores.store_name,
                           stores.owner, stores.city, stores.plan, stores.data_json
                    from users
                    join stores on stores.id = users.store_id
                    where users.login = ?
                    """,
                    (login,),
                ).fetchone()
            if not user or not verify_password(password, user["password_hash"]):
                record_login_failure(login_ip, login)
                self.json_response({"error": "Неверный логин или пароль"}, HTTPStatus.UNAUTHORIZED)
                return
            clear_login_failures(login_ip, login)
            session_cookie, csrf_token = self.start_session(user)
            self.json_response({"user": self.public_user(user, csrf_token)}, headers={"Set-Cookie": session_cookie})
            return

        if path == "/api/logout":
            token = self.session_token()
            if token:
                self.delete_session(token)
            secure = "; Secure" if COOKIE_SECURE else ""
            self.json_response({"ok": True}, headers={"Set-Cookie": f"{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite={COOKIE_SAMESITE}{secure}"})
            return

        move_item_id = parse_inventory_move_path(path)
        if move_item_id is not None:
            user = self.require_user()
            if not user:
                return
            body = self.read_json()
            item, data = move_inventory_item(user, move_item_id, str(body.get("type", "")), body.get("qty"), body.get("reason", ""))
            self.json_response(response_payload_for_collection(user, data, "inventory", "inventory", item))
            return

        if path in API_COLLECTIONS:
            user = self.require_user()
            if not user:
                return
            collection_name, response_key, owner_only = API_COLLECTIONS[path]
            if owner_only and not require_owner_role(self, user):
                return
            body = self.read_json()
            record = body.get("record", body)
            if not isinstance(record, dict):
                self.json_response({"error": "Некорректная запись"}, HTTPStatus.BAD_REQUEST)
                return
            created, data = create_entity(user, collection_name, response_key, record)
            LOGGER.info("api_create store=%s user=%s endpoint=%s id=%s", user["store_id"], user["login"], path, created.get("id"))
            self.json_response(response_payload_for_collection(user, data, response_key, collection_name, created), HTTPStatus.CREATED)
            return

        if path == "/api/track/location":
            # Публичный — курьер без авторизации шлёт координаты
            body = self.read_json()
            token = body.get("token", "")
            with connect() as db:
                row = _exec(db, "select * from delivery_tokens where token=?", (token,)).fetchone()
                info = dict(row) if row else None
            if not info or time.time() > info.get("expires", 0):
                self.json_response({"error": "Токен недействителен"}, HTTPStatus.FORBIDDEN)
                return
            try:
                lat = float(body.get("lat", 0))
                lng = float(body.get("lng", 0))
                acc = int(body.get("acc", 0))
            except (TypeError, ValueError):
                self.json_response({"error": "Некорректные координаты"}, HTTPStatus.BAD_REQUEST)
                return
            loc_key = "track:" + str(info["store_id"]) + ":" + str(info["order_id"])
            with connect() as db:
                _exec(db, "insert or replace into courier_locs (key,lat,lng,acc,ts) values (?,?,?,?,?)",
                      (loc_key, lat, lng, acc, time.time()))
                db.commit()
            self.json_response({"ok": True})
            return

        if path == "/api/track/generate":
            # Авторизованный — владелец/менеджер генерирует ссылки для заказа
            user = self.require_user()
            if not user:
                return
            body = self.read_json()
            order_id = str(body.get("orderId", ""))
            if not order_id:
                self.json_response({"error": "orderId обязателен"}, HTTPStatus.BAD_REQUEST)
                return
            store_id = str(user["store_id"])
            courier_token = secrets.token_urlsafe(20)
            client_token = secrets.token_urlsafe(20)
            expires = time.time() + 24 * 3600  # 24 часа
            with connect() as db:
                _exec(db, "insert or replace into delivery_tokens (token,store_id,order_id,type,expires) values (?,?,?,?,?)",
                      (courier_token, store_id, order_id, "courier", expires))
                _exec(db, "insert or replace into delivery_tokens (token,store_id,order_id,type,expires) values (?,?,?,?,?)",
                      (client_token, store_id, order_id, "client", expires))
                db.commit()
            base = self.headers.get("Origin") or f"https://{self.headers.get('Host', '')}"
            self.json_response({
                "courierLink": f"{base}/track/{courier_token}",
                "clientLink": f"{base}/track/{client_token}"
            })
            return

        if path == "/api/courier/location":
            user = self.require_user()
            if not user:
                return
            body = self.read_json()
            try:
                lat = float(body.get("lat", 0))
                lng = float(body.get("lng", 0))
            except (TypeError, ValueError):
                self.json_response({"error": "Некорректные координаты"}, HTTPStatus.BAD_REQUEST)
                return
            if not lat or not lng:
                self.json_response({"error": "Координаты не переданы"}, HTTPStatus.BAD_REQUEST)
                return
            key = f"{user['store_id']}:{user['login']}"
            courier_locations[key] = {
                "lat": lat,
                "lng": lng,
                "name": user.get("name") or user.get("login", "Курьер"),
                "login": user["login"],
                "ts": int(time.time())
            }
            self.json_response({"ok": True})
            return

        if path in {"/api/delivery/status", "/api/orders/status"}:
            user = self.require_user()
            if not user:
                return
            body = self.read_json()
            try:
                order, data = patch_order_status(user, int(body.get("orderId", 0)), str(body.get("status", "")))
            except PermissionError as error:
                self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
                return
            except LookupError as error:
                self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
                return
            except (TypeError, ValueError) as error:
                self.json_response({"error": str(error) or "Некорректный статус заказа"}, HTTPStatus.BAD_REQUEST)
                return
            self.json_response(response_payload_for_collection(user, data, "orders", "orders", order))
            return

        if path == "/api/trash/restore":
            user = self.require_user()
            if not user:
                return
            body = self.read_json()
            try:
                restored, data = restore_deleted_item(user, str(body.get("type", "")), body.get("deletedId"))
            except PermissionError as error:
                self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
                return
            except LookupError as error:
                self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
                return
            except (TypeError, ValueError) as error:
                self.json_response({"error": str(error)}, HTTPStatus.BAD_REQUEST)
                return
            self.json_response({"ok": True, "record": restored, "data": filter_data_for_role(user, data)})
            return

        if path == "/api/settings":
            user = self.require_user()
            if not user:
                return
            if not require_owner_role(self, user):
                return
            body = self.read_json()
            settings = body.get("settings", body)
            if not isinstance(settings, dict):
                self.json_response({"error": "Некорректные настройки"}, HTTPStatus.BAD_REQUEST)
                return
            data = load_store_data(user)
            clean_settings = sanitize_crm_value({**default_store_settings(user["city"]), **settings})
            if not isinstance(clean_settings, dict):
                self.json_response({"error": "Некорректные настройки"}, HTTPStatus.BAD_REQUEST)
                return
            data["settings"] = clean_settings
            add_backend_audit(data, user, "update", "settings", "settings", "Настройки магазина обновлены")
            save_store_data(user, data)
            LOGGER.info("settings_update store=%s user=%s", user["store_id"], user["login"])
            self.json_response({"settings": clean_settings})
            return

        if path == "/api/backup":
            user = self.require_user()
            if not user:
                return
            if not require_owner_role(self, user):
                return
            backup_path = create_backup(str(user["store_id"]))
            data = load_store_data(user)
            add_backend_audit(data, user, "backup", "store", user["store_id"], backup_path.name)
            save_store_data(user, data)
            LOGGER.info("backup_created store=%s user=%s file=%s", user["store_id"], user["login"], backup_path.name)
            self.json_response({"ok": True, "backup": backup_path.name})
            return

        if path == "/api/users":
            user = self.require_user()
            if not user:
                return
            if user["role"] != "owner":
                self.json_response({"error": "Доступ только для владельца"}, HTTPStatus.FORBIDDEN)
                return
            body = self.read_json()
            name = str(body.get("name", "")).strip()
            login = str(body.get("login", "")).strip().lower()
            password = str(body.get("password", ""))
            role = str(body.get("role", "manager")).strip() or "manager"
            if role not in {"owner", "manager", "florist", "courier", "operator"}:
                role = "manager"
            if not name or not login or not password:
                self.json_response({"error": "Заполните имя, email и пароль"}, HTTPStatus.BAD_REQUEST)
                return
            if "@" not in login or "." not in login:
                self.json_response({"error": "Введите корректный email"}, HTTPStatus.BAD_REQUEST)
                return
            if not strong_password(password):
                self.json_response({"error": "Пароль должен быть минимум 10 символов, с большой и маленькой буквой, цифрой и спецсимволом"}, HTTPStatus.BAD_REQUEST)
                return
            with connect() as db:
                if _exec(db, "select 1 from users where login = ?", (login,)).fetchone():
                    self.json_response({"error": "Такой email уже зарегистрирован"}, HTTPStatus.CONFLICT)
                    return
                cursor = _exec(db, 
                    "insert into users (store_id, login, password_hash, name, role) values (?, ?, ?, ?, ?)",
                    (user["store_row_id"], login, hash_password(password), name, role),
                )
                created = _exec(db, "select id, login, name, role from users where id = ?", (_lastrowid(db, cursor),)).fetchone()
            data = load_store_data(user)
            add_backend_audit(data, user, "create", "user", created["id"], f"{created['login']} · {created['role']}")
            save_store_data(user, data)
            self.json_response({"user": dict(created)}, HTTPStatus.CREATED)
            return

        if path == "/api/reset":
            if is_limited("reset", self.client_ip(), 5, 10 * 60):
                self.json_response({"error": "Слишком много запросов сброса. Попробуйте позже."}, HTTPStatus.TOO_MANY_REQUESTS)
                return
            user = self.require_user()
            if not user:
                return
            if not require_owner_role(self, user):
                return
            reset_data = materialize_dates(DEMO_DATA[user["store_id"]]) if user["store_id"] in DEMO_DATA else empty_store_data()
            add_backend_audit(reset_data, user, "reset", "store", user["store_id"], "Сброс демо-данных")
            with connect() as db:
                _exec(db, 
                    "update stores set data_json = ? where id = ?",
                    (json.dumps(reset_data, ensure_ascii=False), user["store_row_id"]),
                )
            self.json_response({"data": reset_data})
            return

        self.json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def handle_api_put(self) -> None:
        if self.path != "/api/data":
            self.json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        if not self.verify_csrf():
            return
        user = self.require_user()
        if not user:
            return
        if not require_owner_role(self, user):
            return
        body = self.read_json()
        try:
            data = validate_crm_data(body.get("data"))
        except ValueError as error:
            self.json_response({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        with connect() as db:
            _exec(db, 
                "update stores set data_json = ? where id = ?",
                (json.dumps(data, ensure_ascii=False), user["store_row_id"]),
            )
        self.json_response({"ok": True})

    def handle_api_patch(self) -> None:
        path = urlparse(self.path).path
        if not self.verify_csrf():
            return
        user = self.require_user()
        if not user:
            return
        if path == "/api/settings":
            if not require_owner_role(self, user):
                return
            body = self.read_json()
            settings = body.get("settings", body)
            if not isinstance(settings, dict):
                self.json_response({"error": "Некорректные настройки"}, HTTPStatus.BAD_REQUEST)
                return
            data = load_store_data(user)
            clean_settings = sanitize_crm_value({**data.get("settings", default_store_settings(user["city"])), **settings})
            if not isinstance(clean_settings, dict):
                self.json_response({"error": "Некорректные настройки"}, HTTPStatus.BAD_REQUEST)
                return
            data["settings"] = clean_settings
            add_backend_audit(data, user, "update", "settings", "settings", "Настройки магазина обновлены")
            save_store_data(user, data)
            self.json_response({"settings": clean_settings, "data": filter_data_for_role(user, data)})
            return
        if path in {"/api/delivery/status", "/api/orders/status"}:
            body = self.read_json()
            try:
                order, data = patch_order_status(user, int(body.get("orderId", 0)), str(body.get("status", "")))
            except PermissionError as error:
                self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
                return
            except LookupError as error:
                self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
                return
            except (TypeError, ValueError) as error:
                self.json_response({"error": str(error) or "Некорректный статус заказа"}, HTTPStatus.BAD_REQUEST)
                return
            self.json_response(response_payload_for_collection(user, data, "orders", "orders", order))
            return
        parsed_entity = parse_entity_path(path)
        if not parsed_entity:
            self.json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        collection_name, response_key, owner_only, record_id = parsed_entity
        if owner_only and not require_owner_role(self, user):
            return
        body = self.read_json()
        record = body.get("record", body)
        if not isinstance(record, dict):
            self.json_response({"error": "Некорректная запись"}, HTTPStatus.BAD_REQUEST)
            return
        if collection_name == "orders" and user["role"] in {"florist", "courier"}:
            if set(record.keys()) != {"status"}:
                self.json_response({"error": "Эта роль может менять только статус заказа"}, HTTPStatus.FORBIDDEN)
                return
            try:
                updated, data = patch_order_status(user, record_id, str(record.get("status", "")))
            except PermissionError as error:
                self.json_response({"error": str(error)}, HTTPStatus.FORBIDDEN)
                return
            except LookupError as error:
                self.json_response({"error": str(error)}, HTTPStatus.NOT_FOUND)
                return
            except ValueError as error:
                self.json_response({"error": str(error)}, HTTPStatus.BAD_REQUEST)
                return
            self.json_response(response_payload_for_collection(user, data, response_key, collection_name, updated))
            return
        updated, data = patch_entity(user, collection_name, response_key, record_id, record)
        self.json_response(response_payload_for_collection(user, data, response_key, collection_name, updated))

    def handle_api_delete(self) -> None:
        path = urlparse(self.path).path
        if not self.verify_csrf():
            return
        user = self.require_user()
        if not user:
            return
        parsed_entity = parse_entity_path(path)
        if not parsed_entity:
            self.json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        collection_name, response_key, owner_only, record_id = parsed_entity
        if owner_only and not require_owner_role(self, user):
            return
        deleted, data = delete_entity(user, collection_name, response_key, record_id)
        self.json_response({"ok": True, "record": deleted, "data": filter_data_for_role(user, data)})

    def current_user(self) -> sqlite3.Row | None:
        token = self.session_token()
        if not token:
            return None
        with connect() as db:
            return _exec(db, 
                """
                select users.id user_id, users.login, users.name, users.role,
                       stores.id store_row_id, stores.store_id, stores.store_name,
                       stores.owner, stores.city, stores.plan, stores.data_json,
                       sessions.csrf_token
                from sessions
                join users on users.id = sessions.user_id
                join stores on stores.id = users.store_id
                where sessions.token = ? and sessions.expires_at > ?
                """,
                (token, time.time()),
            ).fetchone()

    def require_user(self) -> sqlite3.Row | None:
        user = self.current_user()
        if not user:
            self.json_response({"error": "Требуется вход"}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def verify_csrf(self) -> bool:
        user = self.current_user()
        if not user:
            self.json_response({"error": "Требуется вход"}, HTTPStatus.UNAUTHORIZED)
            return False
        expected = user["csrf_token"] if "csrf_token" in user.keys() else ""
        supplied = self.headers.get("X-CSRF-Token", "")
        if not expected or not supplied or not hmac.compare_digest(str(expected), str(supplied)):
            self.json_response({"error": "Защитный токен устарел. Обновите страницу и войдите снова."}, HTTPStatus.FORBIDDEN)
            return False
        return True

    def public_user(self, user: sqlite3.Row, csrf_token: str | None = None) -> dict:
        if csrf_token is None and "csrf_token" in user.keys():
            csrf_token = user["csrf_token"]
        payload = {
            "storeId": user["store_id"],
            "login": user["login"],
            "name": user["name"],
            "role": user["role"],
            "storeName": user["store_name"],
            "owner": user["owner"],
            "city": user["city"],
            "plan": user["plan"],
        }
        if csrf_token:
            payload["csrfToken"] = csrf_token
        return payload

    def session_token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie"))
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def client_ip(self) -> str:
        return self.client_address[0] if self.client_address else "unknown"

    def session_cookie(self, token: str) -> str:
        secure = "; Secure" if COOKIE_SECURE else ""
        expires = formatdate(time.time() + SESSION_TTL_SECONDS, usegmt=True)
        return f"{COOKIE_NAME}={token}; Path=/; Max-Age={SESSION_TTL_SECONDS}; Expires={expires}; HttpOnly; SameSite={COOKIE_SAMESITE}{secure}"

    def start_session(self, user: sqlite3.Row) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(32)
        now = time.time()
        with connect() as db:
            _exec(db, 
                "insert into sessions (token, user_id, created_at, expires_at, csrf_token) values (?, ?, ?, ?, ?)",
                (token, int(user["user_id"]), now, now + SESSION_TTL_SECONDS, csrf_token),
            )
            _exec(db, "delete from sessions where expires_at <= ?", (now,))
        return self.session_cookie(token), csrf_token

    def delete_session(self, token: str) -> None:
        sessions.pop(token, None)
        with connect() as db:
            _exec(db, "delete from sessions where token = ?", (token,))

    def user_by_login(self, login: str) -> sqlite3.Row | None:
        with connect() as db:
            return _exec(db, 
                """
                select users.id user_id, users.login, users.password_hash, users.name, users.role,
                       stores.id store_row_id, stores.store_id, stores.store_name,
                       stores.owner, stores.city, stores.plan, stores.data_json
                from users
                join stores on stores.id = users.store_id
                where users.login = ?
                """,
                (login,),
            ).fetchone()

    def read_form(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body too large")
        raw = self.rfile.read(length).decode("utf-8")
        return {key: values[0] if values else "" for key, values in parse_qs(raw, keep_blank_values=True).items()}

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ValueError("Request body too large")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def redirect_response(self, location: str, headers: dict | None = None) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()

    def bytes_response(self, raw: bytes, content_type: str, filename: str | None = None, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(raw)

    def json_response(self, payload: dict, status: HTTPStatus = HTTPStatus.OK, headers: dict | None = None) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, format: str, *args: object) -> None:
        LOGGER.info("%s - %s", self.client_ip(), format % args)


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((APP_HOST, APP_PORT), BloomHandler)
    print(f"JA Bloom362 backend running at http://{APP_HOST}:{APP_PORT}/")
    server.serve_forever()


if __name__ == "__main__":
    main()

