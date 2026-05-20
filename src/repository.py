import logging
import os
import sqlite3
from pathlib import Path

import requests as _http

logger = logging.getLogger(__name__)

_SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
_SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
USE_SUPABASE = bool(_SUPABASE_URL and _SUPABASE_KEY)

_REST = f"{_SUPABASE_URL}/rest/v1/clean_records"
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
                name       TEXT NOT NULL,
                email      TEXT NOT NULL,
                cpf        TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


def save(record: dict) -> None:
    if USE_SUPABASE:
        resp = _http.post(_REST, json={
            "name": record["name"],
            "email": record["email"],
            "cpf": record["cpf"],
        }, headers=_HEADERS, timeout=10)
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO clean_records (name, email, cpf) VALUES (?, ?, ?)",
            (record["name"], record["email"], record["cpf"]),
        )


def all_records() -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            _REST,
            params={"select": "name,email,cpf", "order": "id.asc"},
            headers=_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute(
            "SELECT name, email, cpf FROM clean_records ORDER BY id"
        ).fetchall()]


def clear() -> None:
    if USE_SUPABASE:
        resp = _http.delete(
            _REST,
            params={"id": "gte.1"},
            headers={**_HEADERS, "Prefer": "return=minimal"},
            timeout=10,
        )
        resp.raise_for_status()
        return
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute("DELETE FROM clean_records")
