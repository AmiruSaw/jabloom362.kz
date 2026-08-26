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
PUBLIC_FILES = {"index.html", "styles.css", "app.js"}
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
        i
