import logging
import os
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
    logger.info("Repositório: Supabase ativo (%s)", _SUPABASE_URL)
else:
    logger.info("Repositório: SQLite local (dev/test)")

_DB_PATH = Path(__file__).parent.parent / "output" / "trust_tandem.db"


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
