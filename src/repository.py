import hashlib
import hmac as _hmac
import json
import logging
import os
import secrets
import sqlite3
from pathlib import Path

import requests as _http

logger = logging.getLogger(__name__)

_SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
USE_SUPABASE = bool(_SUPABASE_URL and _SUPABASE_KEY)

_HEADERS = {
    "apikey": _SUPABASE_KEY,
    "Authorization": f"Bearer {_SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

if USE_SUPABASE:
    logger.info("RepositÃ³rio: Supabase ativo (%s)", _SUPABASE_URL)
else:
    logger.info("RepositÃ³rio: SQLite local (dev/test)")

_DB_PATH = Path(__file__).parent.parent / "output" / "trust_tandem.db"


_KEY_PREFIX = "ttai_"


def init_db() -> None:
    if USE_SUPABASE:
        return
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS clean_records (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id  TEXT NOT NULL DEFAULT 'default',
                name       TEXT NOT NULL,
                email      TEXT NOT NULL,
                cpf        TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS review_queue (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id  TEXT NOT NULL DEFAULT 'default',
                name       TEXT NOT NULL,
                email      TEXT,
                cpf        TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenant_api_keys (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id  TEXT NOT NULL,
                key_hash   TEXT NOT NULL UNIQUE,
                label      TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenant_webhooks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id  TEXT NOT NULL UNIQUE,
                url        TEXT NOT NULL,
                secret     TEXT NOT NULL,
                active     INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


# --- clean_records ---

def save(record: dict, tenant_id: str = "default") -> None:
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            json={"tenant_id": tenant_id, "name": record["name"], "email": record["email"], "cpf": record["cpf"]},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO clean_records (tenant_id, name, email, cpf) VALUES (?, ?, ?, ?)",
            (tenant_id, record["name"], record["email"], record["cpf"]),
        )


def all_records(tenant_id: str = "default") -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            params={"select": "name,email,cpf", "order": "id.asc", "tenant_id": f"eq.{tenant_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(
            "SELECT name, email, cpf FROM clean_records WHERE tenant_id = ? ORDER BY id", (tenant_id,)
        ).fetchall()]


def clear(tenant_id: str = "default") -> None:
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            params={"tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=minimal"}, timeout=10,
        )
        resp.raise_for_status()
        return
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute("DELETE FROM clean_records WHERE tenant_id = ?", (tenant_id,))


# --- review_queue ---

def save_to_queue(record: dict, tenant_id: str = "default") -> None:
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            json={"tenant_id": tenant_id, "name": record["name"], "email": record.get("email"), "cpf": record.get("cpf")},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO review_queue (tenant_id, name, email, cpf) VALUES (?, ?, ?, ?)",
            (tenant_id, record["name"], record.get("email"), record.get("cpf")),
        )


def get_queue(tenant_id: str = "default") -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            params={"select": "name,email,cpf", "order": "id.asc", "tenant_id": f"eq.{tenant_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(
            "SELECT name, email, cpf FROM review_queue WHERE tenant_id = ? ORDER BY id", (tenant_id,)
        ).fetchall()]


def remove_from_queue(name: str, tenant_id: str = "default") -> int:
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            params={"name": f"eq.{name}", "tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            cur = conn.execute(
                "DELETE FROM review_queue WHERE name = ? AND tenant_id = ?", (name, tenant_id)
            )
            return cur.rowcount
    return 0


def clear_queue(tenant_id: str = "default") -> None:
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            params={"tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=minimal"}, timeout=10,
        )
        resp.raise_for_status()
        return
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute("DELETE FROM review_queue WHERE tenant_id = ?", (tenant_id,))


# --- tenant_api_keys ---

def create_api_key(tenant_id: str, label: str | None = None) -> tuple[str, int, str]:
    plain = _KEY_PREFIX + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(plain.encode()).hexdigest()
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/tenant_api_keys",
            json={"tenant_id": tenant_id, "key_hash": key_hash, "label": label},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        row = resp.json()[0]
        return plain, row["id"], row.get("created_at", "")
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        cur = conn.execute(
            "INSERT INTO tenant_api_keys (tenant_id, key_hash, label) VALUES (?, ?, ?)",
            (tenant_id, key_hash, label),
        )
        return plain, cur.lastrowid, ""


def validate_api_key(plain_key: str) -> str | None:
    if not plain_key.startswith(_KEY_PREFIX):
        return None
    key_hash = hashlib.sha256(plain_key.encode()).hexdigest()
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_api_keys",
            params={"select": "tenant_id", "key_hash": f"eq.{key_hash}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0]["tenant_id"] if rows else None
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            row = conn.execute(
                "SELECT tenant_id FROM tenant_api_keys WHERE key_hash = ?", (key_hash,)
            ).fetchone()
            return row[0] if row else None
    return None


def list_api_keys(tenant_id: str) -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_api_keys",
            params={"select": "id,label,created_at", "tenant_id": f"eq.{tenant_id}", "order": "id.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(
                "SELECT id, label, created_at FROM tenant_api_keys WHERE tenant_id = ? ORDER BY id",
                (tenant_id,),
            ).fetchall()]
    return []


def revoke_api_key(key_id: int, tenant_id: str) -> int:
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/tenant_api_keys",
            params={"id": f"eq.{key_id}", "tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            return conn.execute(
                "DELETE FROM tenant_api_keys WHERE id = ? AND tenant_id = ?", (key_id, tenant_id)
            ).rowcount
    return 0


# --- tenant_webhooks ---

def save_webhook(tenant_id: str, url: str) -> str:
    secret = secrets.token_hex(32)
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/tenant_webhooks",
            json={"tenant_id": tenant_id, "url": url, "secret": secret, "active": True},
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
            params={"on_conflict": "tenant_id"}, timeout=10,
        )
        resp.raise_for_status()
        return secret
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO tenant_webhooks (tenant_id, url, secret, active) VALUES (?, ?, ?, 1) "
            "ON CONFLICT(tenant_id) DO UPDATE SET url=excluded.url, secret=excluded.secret, active=1",
            (tenant_id, url, secret),
        )
    return secret


def get_webhook(tenant_id: str) -> dict | None:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_webhooks",
            params={"select": "url,secret,active", "tenant_id": f"eq.{tenant_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT url, secret, active FROM tenant_webhooks WHERE tenant_id = ?", (tenant_id,)
            ).fetchone()
            return dict(row) if row else None
    return None


def delete_webhook(tenant_id: str) -> None:
    if USE_SUPABASE:
        _http.delete(
            f"{_SUPABASE_URL}/rest/v1/tenant_webhooks",
            params={"tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=minimal"}, timeout=10,
        ).raise_for_status()
        return
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute("DELETE FROM tenant_webhooks WHERE tenant_id = ?", (tenant_id,))


def fire_webhook(url: str, secret: str, records: list[dict]) -> None:
    payload = json.dumps({"records": records})
    sig = _hmac.new(secret.encode(), payload.encode(), "sha256").hexdigest()
    try:
        _http.post(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "X-Tandem-Signature": f"sha256={sig}"},
            timeout=10,
        )
    except Exception:
        pass
