import hashlib
import hmac as _hmac
import json
import logging
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
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


_KEY_PREFIX = "ttai_"


def init_db() -> None:
    if USE_SUPABASE:
        return
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS clean_records (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id    TEXT NOT NULL DEFAULT 'default',
                name         TEXT NOT NULL,
                email        TEXT NOT NULL,
                cpf          TEXT NOT NULL,
                extra_fields TEXT DEFAULT '{}',
                legal_basis  TEXT,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at   TIMESTAMP DEFAULT (datetime('now', '+90 days'))
            )
        """)
        try:
            conn.execute("ALTER TABLE clean_records ADD COLUMN legal_basis TEXT")
        except Exception:
            pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS review_queue (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id            TEXT NOT NULL DEFAULT 'default',
                name                 TEXT NOT NULL,
                email                TEXT,
                cpf                  TEXT,
                extra_fields         TEXT DEFAULT '{}',
                legal_basis          TEXT,
                status               TEXT DEFAULT 'PENDING',
                operator_approved_by TEXT,
                operator_approved_at TIMESTAMP,
                admin_approved_by    TEXT,
                admin_approved_at    TIMESTAMP,
                created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        for _col in [
            "ALTER TABLE review_queue ADD COLUMN legal_basis TEXT",
            "ALTER TABLE review_queue ADD COLUMN status TEXT DEFAULT 'PENDING'",
            "ALTER TABLE review_queue ADD COLUMN operator_approved_by TEXT",
            "ALTER TABLE review_queue ADD COLUMN operator_approved_at TIMESTAMP",
            "ALTER TABLE review_queue ADD COLUMN admin_approved_by TEXT",
            "ALTER TABLE review_queue ADD COLUMN admin_approved_at TIMESTAMP",
        ]:
            try:
                conn.execute(_col)
            except Exception:
                pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenant_field_schemas (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id        TEXT NOT NULL DEFAULT 'default',
                field_key        TEXT NOT NULL,
                label            TEXT NOT NULL,
                field_type       TEXT NOT NULL,
                required         INTEGER DEFAULT 1,
                position         INTEGER DEFAULT 0,
                validation_rules TEXT DEFAULT '{}',
                is_sensitive     INTEGER DEFAULT 0,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, field_key)
            )
        """)
        try:
            conn.execute("ALTER TABLE tenant_field_schemas ADD COLUMN is_sensitive INTEGER DEFAULT 0")
        except Exception:
            pass
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenant_audit_logs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id      TEXT NOT NULL DEFAULT 'default',
                operator_email TEXT NOT NULL,
                record_name    TEXT NOT NULL,
                action         TEXT NOT NULL,
                fields_affected TEXT,
                created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tenant_members (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id  TEXT NOT NULL,
                email      TEXT NOT NULL,
                role       TEXT NOT NULL DEFAULT 'operator',
                invited_by TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, email)
            )
        """)
        # Phase 2: add workspace_id columns (idempotent; ignore if already present)
        for _col in [
            "ALTER TABLE clean_records ADD COLUMN workspace_id INTEGER",
            "ALTER TABLE review_queue ADD COLUMN workspace_id INTEGER",
            "ALTER TABLE tenant_field_schemas ADD COLUMN workspace_id INTEGER",
            "ALTER TABLE tenant_api_keys ADD COLUMN workspace_id INTEGER",
            "ALTER TABLE tenant_webhooks ADD COLUMN workspace_id INTEGER",
            "ALTER TABLE tenant_audit_logs ADD COLUMN workspace_id INTEGER",
        ]:
            try:
                conn.execute(_col)
            except Exception:
                pass


# --- clean_records ---

def save(record: dict, tenant_id: str = "default", workspace_id: int | None = None) -> None:
    legal_basis = record.get("legal_basis")
    extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf", "legal_basis")}
    if USE_SUPABASE:
        body: dict = {"tenant_id": tenant_id, "name": record["name"], "email": record["email"],
                      "cpf": record["cpf"], "extra_fields": extra or {}, "legal_basis": legal_basis}
        if workspace_id is not None:
            body["workspace_id"] = workspace_id
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            json=body,
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO clean_records (tenant_id, name, email, cpf, extra_fields, legal_basis, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (tenant_id, record["name"], record["email"], record["cpf"], json.dumps(extra), legal_basis, workspace_id),
        )


def count_clean_records(tenant_id: str = "default", workspace_id: int | None = None) -> int:
    """Returns exact total count of clean records for a tenant — single HTTP call, no pagination."""
    if USE_SUPABASE:
        params: dict = {"select": "id", "tenant_id": f"eq.{tenant_id}"}
        params["workspace_id"] = f"eq.{workspace_id}" if workspace_id is not None else "is.null"
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            params=params,
            headers={**_HEADERS, "Prefer": "count=exact"},
            timeout=10,
        )
        resp.raise_for_status()
        cr = resp.headers.get("Content-Range", "/0")
        total = cr.split("/")[-1]
        return int(total) if total.lstrip("-").isdigit() else len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            if workspace_id is not None:
                row = conn.execute(
                    "SELECT COUNT(*) FROM clean_records WHERE tenant_id = ? AND workspace_id = ?", (tenant_id, workspace_id)
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT COUNT(*) FROM clean_records WHERE tenant_id = ? AND workspace_id IS NULL", (tenant_id,)
                ).fetchone()
            return row[0] if row else 0
    return 0


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


def get_clean_records_paginated(
    tenant_id: str, after_id: int | None = None, limit: int = 500, workspace_id: int | None = None
) -> tuple[list[dict], int | None]:
    """Cursor-based pagination for clean_records.
    Returns (records, next_cursor_id). next_cursor_id is None when no further pages exist."""
    limit = min(max(limit, 1), 1000)
    fetch = limit + 1  # fetch one extra to detect next page

    if USE_SUPABASE:
        params: dict = {
            "select": "id,name,email,cpf",
            "order": "id.asc",
            "tenant_id": f"eq.{tenant_id}",
            "limit": fetch,
        }
        params["workspace_id"] = f"eq.{workspace_id}" if workspace_id is not None else "is.null"
        if after_id is not None:
            params["id"] = f"gt.{after_id}"
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            params=params, headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        has_more = len(rows) > limit
        page = rows[:limit]
        next_cursor = page[-1]["id"] if has_more and page else None
        return [{"name": r["name"], "email": r["email"], "cpf": r["cpf"]} for r in page], next_cursor

    # SQLite fallback
    with sqlite3.connect(_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        ws_clause = "workspace_id = ?" if workspace_id is not None else "workspace_id IS NULL"
        ws_args: tuple = (workspace_id,) if workspace_id is not None else ()
        if after_id is not None:
            rows = conn.execute(
                f"SELECT id, name, email, cpf FROM clean_records "
                f"WHERE tenant_id = ? AND {ws_clause} AND id > ? ORDER BY id LIMIT ?",
                (tenant_id, *ws_args, after_id, fetch),
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT id, name, email, cpf FROM clean_records "
                f"WHERE tenant_id = ? AND {ws_clause} ORDER BY id LIMIT ?",
                (tenant_id, *ws_args, fetch),
            ).fetchall()
        rows = [dict(r) for r in rows]
        has_more = len(rows) > limit
        page = rows[:limit]
        next_cursor = page[-1]["id"] if has_more and page else None
        return [{"name": r["name"], "email": r["email"], "cpf": r["cpf"]} for r in page], next_cursor


def iter_clean_records_for_export(tenant_id: str, page_size: int = 500):
    """Generator that yields rows for CSV export, streaming page-by-page to avoid memory spikes."""
    after_id = None
    while True:
        if USE_SUPABASE:
            params: dict = {
                "select": "id,name,email,cpf,created_at",
                "order": "id.asc",
                "tenant_id": f"eq.{tenant_id}",
                "limit": page_size,
            }
            if after_id is not None:
                params["id"] = f"gt.{after_id}"
            resp = _http.get(
                f"{_SUPABASE_URL}/rest/v1/clean_records",
                params=params, headers=_HEADERS, timeout=30,
            )
            resp.raise_for_status()
            rows = resp.json()
        else:
            with sqlite3.connect(_DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                if after_id is not None:
                    rows = [dict(r) for r in conn.execute(
                        "SELECT id, name, email, cpf, created_at FROM clean_records "
                        "WHERE tenant_id = ? AND id > ? ORDER BY id LIMIT ?",
                        (tenant_id, after_id, page_size),
                    ).fetchall()]
                else:
                    rows = [dict(r) for r in conn.execute(
                        "SELECT id, name, email, cpf, created_at FROM clean_records "
                        "WHERE tenant_id = ? ORDER BY id LIMIT ?",
                        (tenant_id, page_size),
                    ).fetchall()]

        if not rows:
            return
        for row in rows:
            yield {"name": row["name"], "email": row["email"], "cpf": row["cpf"],
                   "created_at": row.get("created_at") or ""}
        after_id = rows[-1]["id"]
        if len(rows) < page_size:
            return  # last page reached


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

def save_to_queue(record: dict, tenant_id: str = "default", workspace_id: int | None = None) -> None:
    legal_basis = record.get("legal_basis")
    extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf", "legal_basis")}
    if USE_SUPABASE:
        body: dict = {"tenant_id": tenant_id, "name": record["name"], "email": record.get("email"),
                      "cpf": record.get("cpf"), "extra_fields": extra or {}, "legal_basis": legal_basis,
                      "status": "PENDING"}
        if workspace_id is not None:
            body["workspace_id"] = workspace_id
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            json=body,
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO review_queue (tenant_id, name, email, cpf, extra_fields, legal_basis, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (tenant_id, record["name"], record.get("email"), record.get("cpf"), json.dumps(extra), legal_basis, workspace_id),
        )


def save_bulk(records: list[dict], tenant_id: str = "default", workspace_id: int | None = None) -> None:
    """Bulk-insert into clean_records — one HTTP call regardless of record count."""
    if not records:
        return
    if USE_SUPABASE:
        payload = []
        for record in records:
            legal_basis = record.get("legal_basis")
            extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf", "legal_basis")}
            row = {
                "tenant_id": tenant_id, "name": record["name"],
                "email": record["email"], "cpf": record["cpf"],
                "extra_fields": extra or {}, "legal_basis": legal_basis,
            }
            if workspace_id is not None:
                row["workspace_id"] = workspace_id
            payload.append(row)
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            json=payload, headers=_HEADERS, timeout=30,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        for record in records:
            legal_basis = record.get("legal_basis")
            extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf", "legal_basis")}
            if workspace_id is not None:
                conn.execute(
                    "INSERT INTO clean_records (tenant_id, workspace_id, name, email, cpf, extra_fields, legal_basis) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (tenant_id, workspace_id, record["name"], record["email"], record["cpf"], json.dumps(extra), legal_basis),
                )
            else:
                conn.execute(
                    "INSERT INTO clean_records (tenant_id, name, email, cpf, extra_fields, legal_basis) VALUES (?, ?, ?, ?, ?, ?)",
                    (tenant_id, record["name"], record["email"], record["cpf"], json.dumps(extra), legal_basis),
                )


def save_to_queue_bulk(records: list[dict], tenant_id: str = "default", workspace_id: int | None = None) -> None:
    """Bulk-insert into review_queue — one HTTP call regardless of record count."""
    if not records:
        return
    if USE_SUPABASE:
        payload = []
        for record in records:
            legal_basis = record.get("legal_basis")
            extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf", "legal_basis")}
            row = {
                "tenant_id": tenant_id, "name": record["name"],
                "email": record.get("email"), "cpf": record.get("cpf"),
                "extra_fields": extra or {}, "legal_basis": legal_basis,
                "status": "PENDING",
            }
            if workspace_id is not None:
                row["workspace_id"] = workspace_id
            payload.append(row)
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            json=payload, headers=_HEADERS, timeout=30,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        for record in records:
            legal_basis = record.get("legal_basis")
            extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf", "legal_basis")}
            if workspace_id is not None:
                conn.execute(
                    "INSERT INTO review_queue (tenant_id, workspace_id, name, email, cpf, extra_fields, legal_basis) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (tenant_id, workspace_id, record["name"], record.get("email"), record.get("cpf"), json.dumps(extra), legal_basis),
                )
            else:
                conn.execute(
                    "INSERT INTO review_queue (tenant_id, name, email, cpf, extra_fields, legal_basis) VALUES (?, ?, ?, ?, ?, ?)",
                    (tenant_id, record["name"], record.get("email"), record.get("cpf"), json.dumps(extra), legal_basis),
                )


def get_queue(tenant_id: str = "default", status: str = "PENDING", workspace_id: int | None = None) -> list[dict]:
    if USE_SUPABASE:
        params: dict = {
            "select": "name,email,cpf,extra_fields,legal_basis,status,operator_approved_by",
            "order": "id.asc",
            "tenant_id": f"eq.{tenant_id}",
        }
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        if status == "PENDING":
            params["or"] = f"(status.eq.PENDING,status.is.null)"
        elif status != "ALL":
            params["status"] = f"eq.{status}"
        resp = _http.get(f"{_SUPABASE_URL}/rest/v1/review_queue", params=params, headers=_HEADERS, timeout=10)
        resp.raise_for_status()
        rows = resp.json()
        for r in rows:
            if isinstance(r.get("extra_fields"), str):
                try:
                    r["extra_fields"] = json.loads(r["extra_fields"])
                except Exception:
                    r["extra_fields"] = {}
        return rows
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        ws_clause = "workspace_id = ?" if workspace_id is not None else "workspace_id IS NULL"
        ws_args: tuple = (workspace_id,) if workspace_id is not None else ()
        if status == "ALL":
            rows = conn.execute(
                f"SELECT name,email,cpf,extra_fields,legal_basis,status,operator_approved_by "
                f"FROM review_queue WHERE tenant_id=? AND {ws_clause} ORDER BY id",
                (tenant_id, *ws_args),
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT name,email,cpf,extra_fields,legal_basis,status,operator_approved_by "
                f"FROM review_queue WHERE tenant_id=? AND {ws_clause} AND COALESCE(status,'PENDING')=? ORDER BY id",
                (tenant_id, *ws_args, status),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("extra_fields"):
                try:
                    d["extra_fields"] = json.loads(d["extra_fields"])
                except Exception:
                    d["extra_fields"] = {}
            result.append(d)
        return result


def operator_preapprove(
    tenant_id: str, name: str, email: str | None, cpf: str | None, operator_email: str
) -> bool:
    """Mark a PENDING item as OPERATOR_APPROVED, storing corrected email/cpf. Returns True if found."""
    now = datetime.now(timezone.utc).isoformat()
    update: dict = {
        "status": "OPERATOR_APPROVED",
        "operator_approved_by": operator_email,
        "operator_approved_at": now,
    }
    if email is not None:
        update["email"] = email
    if cpf is not None:
        update["cpf"] = cpf

    if USE_SUPABASE:
        resp = _http.patch(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            json=update,
            params={"name": f"eq.{name}", "tenant_id": f"eq.{tenant_id}",
                    "or": f"(status.eq.PENDING,status.is.null)"},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json()) > 0

    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            sets = ["status='OPERATOR_APPROVED'", "operator_approved_by=?", "operator_approved_at=?"]
            args: list = [operator_email, now]
            if email is not None:
                sets.append("email=?"); args.append(email)
            if cpf is not None:
                sets.append("cpf=?"); args.append(cpf)
            args.extend([name, tenant_id])
            cur = conn.execute(
                f"UPDATE review_queue SET {', '.join(sets)} "
                "WHERE name=? AND tenant_id=? AND COALESCE(status,'PENDING')='PENDING'",
                args,
            )
            return cur.rowcount > 0
    return False


def admin_finalize(tenant_id: str, name: str, admin_email: str) -> dict | None:
    """Fetch and remove an OPERATOR_APPROVED item; returns its data for final processing."""
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            params={"select": "name,email,cpf,extra_fields,legal_basis",
                    "name": f"eq.{name}", "tenant_id": f"eq.{tenant_id}",
                    "status": "eq.OPERATOR_APPROVED"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return None
        record = rows[0]
        _http.delete(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            params={"name": f"eq.{name}", "tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=minimal"}, timeout=10,
        ).raise_for_status()
        if isinstance(record.get("extra_fields"), str):
            try:
                record["extra_fields"] = json.loads(record["extra_fields"])
            except Exception:
                record["extra_fields"] = {}
        return record

    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT name,email,cpf,extra_fields,legal_basis FROM review_queue "
                "WHERE name=? AND tenant_id=? AND status='OPERATOR_APPROVED'",
                (name, tenant_id),
            ).fetchone()
            if not row:
                return None
            d = dict(row)
            if d.get("extra_fields"):
                try:
                    d["extra_fields"] = json.loads(d["extra_fields"])
                except Exception:
                    d["extra_fields"] = {}
            conn.execute("DELETE FROM review_queue WHERE name=? AND tenant_id=?", (name, tenant_id))
            return d
    return None


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


def create_audit_log(
    tenant_id: str,
    operator_email: str,
    record_name: str,
    action: str,
    fields_affected: dict | None = None,
    workspace_id: int | None = None,
) -> None:
    """Writes an immutable compliance event. Never raises — audit must not break the main flow."""
    payload = fields_affected or {}
    try:
        if USE_SUPABASE:
            body: dict = {
                "tenant_id": tenant_id,
                "operator_email": operator_email,
                "record_name": record_name,
                "action": action,
                "fields_affected": payload,
            }
            if workspace_id is not None:
                body["workspace_id"] = workspace_id
            _http.post(
                f"{_SUPABASE_URL}/rest/v1/tenant_audit_logs",
                json=body,
                headers=_HEADERS, timeout=10,
            ).raise_for_status()
            return
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tenant_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id TEXT NOT NULL,
                    operator_email TEXT NOT NULL,
                    record_name TEXT NOT NULL,
                    action TEXT NOT NULL,
                    fields_affected TEXT,
                    workspace_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            try:
                conn.execute("ALTER TABLE tenant_audit_logs ADD COLUMN workspace_id INTEGER")
            except Exception:
                pass
            conn.execute(
                "INSERT INTO tenant_audit_logs (tenant_id, operator_email, record_name, action, fields_affected, workspace_id)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (tenant_id, operator_email, record_name, action, json.dumps(payload), workspace_id),
            )
    except Exception as exc:
        logger.warning("create_audit_log failed (non-fatal): %s", exc)


def list_audit_logs(tenant_id: str, limit: int = 100, workspace_id: int | None = None) -> list[dict]:
    if USE_SUPABASE:
        params: dict = {
            "select": "id,operator_email,record_name,action,fields_affected,created_at",
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc",
            "limit": limit,
        }
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_audit_logs",
            params=params,
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            if workspace_id is not None:
                return [dict(r) for r in conn.execute(
                    "SELECT id, operator_email, record_name, action, fields_affected, created_at"
                    " FROM tenant_audit_logs WHERE tenant_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT ?",
                    (tenant_id, workspace_id, limit),
                ).fetchall()]
            return [dict(r) for r in conn.execute(
                "SELECT id, operator_email, record_name, action, fields_affected, created_at"
                " FROM tenant_audit_logs WHERE tenant_id = ? AND workspace_id IS NULL ORDER BY created_at DESC LIMIT ?",
                (tenant_id, limit),
            ).fetchall()]
    return []


def purge_expired_queue(tenant_id: str | None = None, days: int = 30) -> int:
    """LGPD Art. 15 — deletes review_queue records older than `days` days.
    Pass tenant_id=None to purge across all tenants (super-admin / pg_cron use)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    if USE_SUPABASE:
        params: dict = {"created_at": f"lt.{cutoff}"}
        if tenant_id:
            params["tenant_id"] = f"eq.{tenant_id}"
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            params=params,
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            clause = "created_at < ?"
            args: list = [cutoff]
            if tenant_id:
                clause += " AND tenant_id = ?"
                args.append(tenant_id)
            return conn.execute(f"DELETE FROM review_queue WHERE {clause}", args).rowcount
    return 0


# --- tenant_api_keys ---

def create_api_key(tenant_id: str, label: str | None = None, workspace_id: int | None = None) -> tuple[str, int, str]:
    plain = _KEY_PREFIX + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(plain.encode()).hexdigest()
    if USE_SUPABASE:
        payload = {"tenant_id": tenant_id, "key_hash": key_hash, "label": label}
        if workspace_id is not None:
            payload["workspace_id"] = workspace_id
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/tenant_api_keys",
            json=payload,
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        row = resp.json()[0]
        return plain, row["id"], row.get("created_at", "")
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        if workspace_id is not None:
            cur = conn.execute(
                "INSERT INTO tenant_api_keys (tenant_id, workspace_id, key_hash, label) VALUES (?, ?, ?, ?)",
                (tenant_id, workspace_id, key_hash, label),
            )
        else:
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


def list_api_keys(tenant_id: str, workspace_id: int | None = None) -> list[dict]:
    if USE_SUPABASE:
        params: dict = {"select": "id,label,created_at", "tenant_id": f"eq.{tenant_id}", "order": "id.asc"}
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_api_keys",
            params=params,
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            if workspace_id is not None:
                return [dict(r) for r in conn.execute(
                    "SELECT id, label, created_at FROM tenant_api_keys WHERE tenant_id = ? AND workspace_id = ? ORDER BY id",
                    (tenant_id, workspace_id),
                ).fetchall()]
            else:
                return [dict(r) for r in conn.execute(
                    "SELECT id, label, created_at FROM tenant_api_keys WHERE tenant_id = ? AND workspace_id IS NULL ORDER BY id",
                    (tenant_id,),
                ).fetchall()]
    return []


def revoke_api_key(key_id: int, tenant_id: str, workspace_id: int | None = None) -> int:
    if USE_SUPABASE:
        params: dict = {"id": f"eq.{key_id}", "tenant_id": f"eq.{tenant_id}"}
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/tenant_api_keys",
            params=params,
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            if workspace_id is not None:
                return conn.execute(
                    "DELETE FROM tenant_api_keys WHERE id = ? AND tenant_id = ? AND workspace_id = ?", (key_id, tenant_id, workspace_id)
                ).rowcount
            else:
                return conn.execute(
                    "DELETE FROM tenant_api_keys WHERE id = ? AND tenant_id = ? AND workspace_id IS NULL", (key_id, tenant_id)
                ).rowcount
    return 0


# --- tenant_webhooks ---

def save_webhook(tenant_id: str, url: str, workspace_id: int | None = None) -> str:
    secret = secrets.token_hex(32)
    if USE_SUPABASE:
        payload = {"tenant_id": tenant_id, "url": url, "secret": secret, "active": True}
        if workspace_id is not None:
            payload["workspace_id"] = workspace_id
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/tenant_webhooks",
            json=payload,
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
            params={"on_conflict": "tenant_id,workspace_id"}, timeout=10,
        )
        resp.raise_for_status()
        return secret
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        if workspace_id is not None:
            conn.execute(
                "INSERT INTO tenant_webhooks (tenant_id, workspace_id, url, secret, active) VALUES (?, ?, ?, ?, 1) "
                "ON CONFLICT(tenant_id) DO UPDATE SET url=excluded.url, secret=excluded.secret, active=1",
                (tenant_id, workspace_id, url, secret),
            )
        else:
            conn.execute(
                "INSERT INTO tenant_webhooks (tenant_id, url, secret, active) VALUES (?, ?, ?, 1) "
                "ON CONFLICT(tenant_id) DO UPDATE SET url=excluded.url, secret=excluded.secret, active=1",
                (tenant_id, url, secret),
            )
    return secret


def get_webhook(tenant_id: str, workspace_id: int | None = None) -> dict | None:
    if USE_SUPABASE:
        params: dict = {"select": "url,secret,active", "tenant_id": f"eq.{tenant_id}"}
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_webhooks",
            params=params,
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            if workspace_id is not None:
                row = conn.execute(
                    "SELECT url, secret, active FROM tenant_webhooks WHERE tenant_id = ? AND workspace_id = ?", (tenant_id, workspace_id)
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT url, secret, active FROM tenant_webhooks WHERE tenant_id = ? AND workspace_id IS NULL", (tenant_id,)
                ).fetchone()
            return dict(row) if row else None
    return None


def delete_webhook(tenant_id: str, workspace_id: int | None = None) -> None:
    if USE_SUPABASE:
        params: dict = {"tenant_id": f"eq.{tenant_id}"}
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        _http.delete(
            f"{_SUPABASE_URL}/rest/v1/tenant_webhooks",
            params=params,
            headers={**_HEADERS, "Prefer": "return=minimal"}, timeout=10,
        ).raise_for_status()
        return
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.execute("DELETE FROM tenant_webhooks WHERE tenant_id = ?", (tenant_id,))


# --- tenant_field_schemas ---

_DEFAULT_SCHEMA: list[dict] = [
    {"field_key": "email", "label": "E-mail",   "field_type": "email", "required": True,  "position": 1, "validation_rules": {}},
    {"field_key": "cpf",   "label": "CPF/CNPJ", "field_type": "cpf",   "required": True,  "position": 2, "validation_rules": {}},
]

PLAN_LIMITS: dict[str, int] = {
    "starter":      5,
    "pro":          15,
    "professional": 20,
    "enterprise":   999,
}


def _merge_with_defaults(custom_rows: list[dict]) -> list[dict]:
    """Always includes _DEFAULT_SCHEMA fields; custom rows override defaults for same key."""
    merged = {f["field_key"]: dict(f) for f in _DEFAULT_SCHEMA}
    for row in custom_rows:
        merged[row["field_key"]] = row
    return sorted(merged.values(), key=lambda f: f.get("position", 0))


def get_tenant_schema(tenant_id: str, workspace_id: int | None = None) -> list[dict]:
    if USE_SUPABASE:
        params: dict = {"select": "field_key,label,field_type,required,position,validation_rules,is_sensitive",
                        "tenant_id": f"eq.{tenant_id}", "order": "position.asc"}
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            params=params,
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        for r in rows:
            r.setdefault("is_sensitive", False)
        return _merge_with_defaults(rows)
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            if workspace_id is not None:
                rows = conn.execute(
                    "SELECT field_key, label, field_type, required, position, validation_rules,"
                    " COALESCE(is_sensitive, 0) as is_sensitive"
                    " FROM tenant_field_schemas WHERE tenant_id = ? AND workspace_id = ? ORDER BY position",
                    (tenant_id, workspace_id)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT field_key, label, field_type, required, position, validation_rules,"
                    " COALESCE(is_sensitive, 0) as is_sensitive"
                    " FROM tenant_field_schemas WHERE tenant_id = ? AND workspace_id IS NULL ORDER BY position",
                    (tenant_id,)
                ).fetchall()
            custom = []
            for r in rows:
                d = dict(r)
                try:
                    d["validation_rules"] = json.loads(d.get("validation_rules") or "{}")
                except Exception:
                    d["validation_rules"] = {}
                d["required"] = bool(d["required"])
                d["is_sensitive"] = bool(d.get("is_sensitive", False))
                custom.append(d)
            return _merge_with_defaults(custom)
    return list(_DEFAULT_SCHEMA)


def upsert_field_schema(tenant_id: str, field: dict, workspace_id: int | None = None) -> None:
    if USE_SUPABASE:
        row = {"tenant_id": tenant_id, **field, "is_sensitive": bool(field.get("is_sensitive", False))}
        if workspace_id is not None:
            row["workspace_id"] = workspace_id
        _http.post(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            json=row,
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "tenant_id,field_key,workspace_id"}, timeout=10,
        ).raise_for_status()
        return
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        if workspace_id is not None:
            conn.execute(
                "INSERT INTO tenant_field_schemas"
                " (tenant_id, workspace_id, field_key, label, field_type, required, position, validation_rules, is_sensitive)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(tenant_id, field_key) DO UPDATE SET"
                " label=excluded.label, field_type=excluded.field_type, required=excluded.required,"
                " position=excluded.position, validation_rules=excluded.validation_rules,"
                " is_sensitive=excluded.is_sensitive",
                (tenant_id, workspace_id, field["field_key"], field["label"], field["field_type"],
                 1 if field.get("required", True) else 0, field.get("position", 0),
                 json.dumps(field.get("validation_rules", {})),
                 1 if field.get("is_sensitive", False) else 0),
            )
        else:
            conn.execute(
                "INSERT INTO tenant_field_schemas"
                " (tenant_id, field_key, label, field_type, required, position, validation_rules, is_sensitive)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(tenant_id, field_key) DO UPDATE SET"
                " label=excluded.label, field_type=excluded.field_type, required=excluded.required,"
                " position=excluded.position, validation_rules=excluded.validation_rules,"
                " is_sensitive=excluded.is_sensitive",
                (tenant_id, field["field_key"], field["label"], field["field_type"],
                 1 if field.get("required", True) else 0, field.get("position", 0),
                 json.dumps(field.get("validation_rules", {})),
                 1 if field.get("is_sensitive", False) else 0),
            )


def get_tenant_plan(tenant_id: str) -> str:
    """Returns the tenant's effective plan name. During trial returns 'pro'; after expiry 'starter'."""
    if tenant_id == "__admin__":
        return "enterprise"
    if USE_SUPABASE:
        try:
            resp = _http.get(
                f"{_SUPABASE_URL}/rest/v1/tenants",
                params={"select": "plan,subscription_status,trial_ends_at", "id": f"eq.{tenant_id}"},
                headers=_HEADERS, timeout=10,
            )
            resp.raise_for_status()
            rows = resp.json()
            if not rows:
                return "starter"
            row = rows[0]
            status = row.get("subscription_status") or "trialing"
            plan   = row.get("plan") or "starter"
            if status == "active":
                return plan
            if status == "trialing":
                trial_ends_at = row.get("trial_ends_at")
                if trial_ends_at:
                    trial_dt = datetime.fromisoformat(trial_ends_at.replace("Z", "+00:00"))
                    if datetime.now(timezone.utc) < trial_dt:
                        return "pro"
            return "starter"
        except Exception:
            return "starter"
    return "starter"


def ensure_trial_and_upsert(tenant_id: str, company_name: str | None = None) -> None:
    """Creates tenant row if missing, sets 7-day trial if trial_ends_at not yet set."""
    if tenant_id == "__admin__" or not USE_SUPABASE:
        return
    try:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenants",
            params={"select": "id,trial_ends_at", "id": f"eq.{tenant_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        trial_ends = (datetime.now(timezone.utc) + timedelta(days=15)).isoformat()
        if not rows:
            payload: dict = {
                "id": tenant_id, "plan": "starter",
                "subscription_status": "trialing", "trial_ends_at": trial_ends,
            }
            if company_name:
                payload["company_name"] = company_name
            _http.post(
                f"{_SUPABASE_URL}/rest/v1/tenants",
                json=payload,
                headers={**_HEADERS, "Prefer": "resolution=ignore-duplicates,return=minimal"},
                timeout=10,
            ).raise_for_status()
        elif not rows[0].get("trial_ends_at"):
            _http.patch(
                f"{_SUPABASE_URL}/rest/v1/tenants",
                params={"id": f"eq.{tenant_id}"},
                json={"trial_ends_at": trial_ends, "subscription_status": "trialing"},
                headers=_HEADERS, timeout=10,
            ).raise_for_status()
    except Exception as e:
        logger.warning("ensure_trial_and_upsert failed (non-fatal): %s", e)


def get_tenant_subscription(tenant_id: str) -> dict:
    """Returns full subscription status dict for the subscription tab."""
    if tenant_id == "__admin__":
        return {"plan": "enterprise", "effective_plan": "enterprise", "status": "active",
                "trial_ends_at": None, "trial_days_left": None,
                "stripe_customer_id": None, "stripe_subscription_id": None,
                "enterprise_config": None}
    defaults = {"plan": "starter", "effective_plan": "starter", "status": "free",
                "trial_ends_at": None, "trial_days_left": None,
                "stripe_customer_id": None, "stripe_subscription_id": None,
                "enterprise_config": None}
    if not USE_SUPABASE:
        return defaults
    try:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenants",
            params={"select": "plan,subscription_status,trial_ends_at,stripe_customer_id,stripe_subscription_id",
                    "id": f"eq.{tenant_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return defaults
        row = rows[0]
        plan   = row.get("plan") or "starter"
        status = row.get("subscription_status") or "trialing"
        trial_ends_at = row.get("trial_ends_at")
        trial_days_left: int | None = None
        effective_plan = plan

        if trial_ends_at:
            trial_dt = datetime.fromisoformat(trial_ends_at.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            delta = int((trial_dt - now).total_seconds() // 86400)
            if status == "trialing":
                if now < trial_dt:
                    effective_plan = "pro"
                    trial_days_left = max(0, delta)
                else:
                    status = "expired"
                    effective_plan = "starter"

        if status == "active":
            effective_plan = plan

        enterprise_config = get_enterprise_config(tenant_id)
        return {
            "plan": plan, "effective_plan": effective_plan, "status": status,
            "trial_ends_at": trial_ends_at,
            "trial_days_left": trial_days_left if status == "trialing" else None,
            "stripe_customer_id": row.get("stripe_customer_id"),
            "stripe_subscription_id": row.get("stripe_subscription_id"),
            "enterprise_config": enterprise_config,
        }
    except Exception:
        return defaults


def update_tenant_subscription(
    tenant_id: str, plan: str, status: str,
    stripe_customer_id: str | None = None,
    stripe_subscription_id: str | None = None,
) -> None:
    """Updates tenant subscription after Stripe event."""
    if not USE_SUPABASE:
        return
    payload: dict = {"plan": plan, "subscription_status": status}
    if stripe_customer_id:
        payload["stripe_customer_id"] = stripe_customer_id
    if stripe_subscription_id:
        payload["stripe_subscription_id"] = stripe_subscription_id
    try:
        _http.patch(
            f"{_SUPABASE_URL}/rest/v1/tenants",
            params={"id": f"eq.{tenant_id}"},
            json=payload,
            headers=_HEADERS, timeout=10,
        ).raise_for_status()
    except Exception as e:
        logger.warning("update_tenant_subscription failed: %s", e)


def get_tenant_by_stripe_customer(stripe_customer_id: str) -> str | None:
    """Finds tenant_id by Stripe customer ID for webhook resolution."""
    if not USE_SUPABASE:
        return None
    try:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenants",
            params={"select": "id", "stripe_customer_id": f"eq.{stripe_customer_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0]["id"] if rows else None
    except Exception:
        return None


_DEFAULT_KEYS = {f["field_key"] for f in _DEFAULT_SCHEMA}


def count_field_schemas(tenant_id: str, workspace_id: int | None = None) -> int:
    """Counts only non-default custom fields (email and cpf are free baseline, never counted)."""
    excluded = ",".join(f'"{k}"' for k in _DEFAULT_KEYS)
    if USE_SUPABASE:
        params: dict = {"select": "id", "tenant_id": f"eq.{tenant_id}",
                        "field_key": f"not.in.({','.join(_DEFAULT_KEYS)})"}
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            params=params,
            headers={**_HEADERS, "Prefer": "count=exact"},
            timeout=10,
        )
        resp.raise_for_status()
        cr = resp.headers.get("Content-Range", "/0")
        total = cr.split("/")[-1]
        return int(total) if total.lstrip("-").isdigit() else len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            placeholders = ",".join("?" * len(_DEFAULT_KEYS))
            if workspace_id is not None:
                row = conn.execute(
                    f"SELECT COUNT(*) FROM tenant_field_schemas WHERE tenant_id = ? AND workspace_id = ? AND field_key NOT IN ({placeholders})",
                    (tenant_id, workspace_id, *_DEFAULT_KEYS),
                ).fetchone()
            else:
                row = conn.execute(
                    f"SELECT COUNT(*) FROM tenant_field_schemas WHERE tenant_id = ? AND workspace_id IS NULL AND field_key NOT IN ({placeholders})",
                    (tenant_id, *_DEFAULT_KEYS),
                ).fetchone()
            return row[0] if row else 0
    return 0


def delete_field_schema(tenant_id: str, field_key: str, workspace_id: int | None = None) -> int:
    if field_key in ("name",):
        return 0  # name is always required — cannot be removed
    if USE_SUPABASE:
        params: dict = {"tenant_id": f"eq.{tenant_id}", "field_key": f"eq.{field_key}"}
        if workspace_id is not None:
            params["workspace_id"] = f"eq.{workspace_id}"
        else:
            params["workspace_id"] = "is.null"
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            params=params,
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            if workspace_id is not None:
                return conn.execute(
                    "DELETE FROM tenant_field_schemas WHERE tenant_id = ? AND field_key = ? AND workspace_id = ?",
                    (tenant_id, field_key, workspace_id)
                ).rowcount
            else:
                return conn.execute(
                    "DELETE FROM tenant_field_schemas WHERE tenant_id = ? AND field_key = ? AND workspace_id IS NULL",
                    (tenant_id, field_key)
                ).rowcount
    return 0


# --- admin_plan_configs ---

_PLAN_DEFAULTS: list[dict] = [
    {"plan_name": "starter",      "field_limit": 5,   "price_monthly": 0.0,    "stripe_price_id": None, "records_per_month": 0,      "api_keys_limit": 1,   "diagnoses_per_month": 50,  "workspaces_limit": 1},
    {"plan_name": "pro",          "field_limit": 15,  "price_monthly": 497.0,  "stripe_price_id": None, "records_per_month": 50000,  "api_keys_limit": 5,   "diagnoses_per_month": 0,   "workspaces_limit": 3},
    {"plan_name": "professional", "field_limit": 20,  "price_monthly": 1490.0, "stripe_price_id": None, "records_per_month": 200000, "api_keys_limit": 20,  "diagnoses_per_month": 0,   "workspaces_limit": 10},
    {"plan_name": "enterprise",   "field_limit": 999, "price_monthly": 0.0,    "stripe_price_id": None, "records_per_month": 0,      "api_keys_limit": 999, "diagnoses_per_month": 0,   "workspaces_limit": 999},
]


def get_plan_configs() -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/admin_plan_configs",
            params={"select": "plan_name,field_limit,price_monthly,stripe_price_id,records_per_month,api_keys_limit,diagnoses_per_month,workspaces_limit",
                    "order": "plan_name.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows if rows else _PLAN_DEFAULTS
    return _PLAN_DEFAULTS


def upsert_plan_config(
    plan_name: str, field_limit: int, price_monthly: float, stripe_price_id: str | None,
    records_per_month: int = 0, api_keys_limit: int = 1, diagnoses_per_month: int = 0,
    workspaces_limit: int = 1,
) -> None:
    PLAN_LIMITS[plan_name] = field_limit
    if USE_SUPABASE:
        _http.post(
            f"{_SUPABASE_URL}/rest/v1/admin_plan_configs",
            json={"plan_name": plan_name, "field_limit": field_limit,
                  "price_monthly": price_monthly, "stripe_price_id": stripe_price_id,
                  "records_per_month": records_per_month, "api_keys_limit": api_keys_limit,
                  "diagnoses_per_month": diagnoses_per_month, "workspaces_limit": workspaces_limit,
                  "updated_at": datetime.now(timezone.utc).isoformat()},
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "plan_name"}, timeout=10,
        ).raise_for_status()


def get_enterprise_tier_for_tenant(tenant_id: str) -> dict | None:
    """Returns the enterprise tier a tenant subscribed to, via their stripe_price_id."""
    config = get_enterprise_config(tenant_id)
    if not config:
        return None
    price_id = config.get("stripe_price_id")
    if not price_id:
        return None
    try:
        tiers = get_enterprise_tiers(active_only=False)
        return next((t for t in tiers if t.get("stripe_price_id") == price_id), None)
    except Exception:
        return None


def get_plan_limits(plan_name: str, tenant_id: str | None = None) -> dict:
    """Returns all limits for a given plan. For enterprise, resolves tier-specific limits."""
    if plan_name == "enterprise" and tenant_id:
        tier = get_enterprise_tier_for_tenant(tenant_id)
        if tier:
            return {
                "field_limit":          tier.get("field_limit", 999),
                "records_per_month":    tier.get("records_per_month", 0),
                "api_keys_limit":       tier.get("api_keys_limit", 999),
                "diagnoses_per_month":  tier.get("diagnoses_per_month", 0),
            }
    configs = get_plan_configs()
    cfg = next((c for c in configs if c["plan_name"] == plan_name), None)
    if cfg:
        return {"field_limit": cfg.get("field_limit", 5), "records_per_month": cfg.get("records_per_month", 0),
                "api_keys_limit": cfg.get("api_keys_limit", 1), "diagnoses_per_month": cfg.get("diagnoses_per_month", 0)}
    defaults = next((d for d in _PLAN_DEFAULTS if d["plan_name"] == plan_name), _PLAN_DEFAULTS[0])
    return {"field_limit": defaults["field_limit"], "records_per_month": defaults["records_per_month"],
            "api_keys_limit": defaults["api_keys_limit"], "diagnoses_per_month": defaults["diagnoses_per_month"]}


def get_plan_field_limit(plan_name: str, tenant_id: str | None = None) -> int:
    """Returns field limit. For enterprise, resolves tier-specific limit."""
    if plan_name == "enterprise" and tenant_id:
        tier = get_enterprise_tier_for_tenant(tenant_id)
        if tier:
            return tier.get("field_limit", 999)
    if USE_SUPABASE:
        try:
            resp = _http.get(
                f"{_SUPABASE_URL}/rest/v1/admin_plan_configs",
                params={"select": "field_limit", "plan_name": f"eq.{plan_name}"},
                headers=_HEADERS, timeout=10,
            )
            resp.raise_for_status()
            rows = resp.json()
            if rows:
                return rows[0]["field_limit"]
        except Exception:
            pass
    return PLAN_LIMITS.get(plan_name, 5)


# --- enterprise_tiers ---

def get_enterprise_tiers(active_only: bool = True) -> list[dict]:
    if USE_SUPABASE:
        params: dict = {
            "select": "id,name,description,records_per_month,api_keys_limit,diagnoses_per_month,field_limit,price_monthly,stripe_price_id,active,sort_order,workspaces_limit",
            "order": "sort_order.asc",
        }
        if active_only:
            params["active"] = "eq.true"
        resp = _http.get(f"{_SUPABASE_URL}/rest/v1/enterprise_tiers", params=params, headers=_HEADERS, timeout=10)
        resp.raise_for_status()
        return resp.json()
    return []


def get_enterprise_tier_by_id(tier_id: int) -> dict | None:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/enterprise_tiers",
            params={"select": "id,name,records_per_month,api_keys_limit,field_limit,price_monthly,stripe_price_id,active",
                    "id": f"eq.{tier_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None
    return None


def upsert_enterprise_tier_price(
    tier_id: int,
    stripe_price_id: str | None,
    price_monthly: float | None = None,
    records_per_month: int | None = None,
    api_keys_limit: int | None = None,
    diagnoses_per_month: int | None = None,
    field_limit: int | None = None,
    workspaces_limit: int | None = None,
) -> None:
    if USE_SUPABASE:
        payload: dict = {"stripe_price_id": stripe_price_id}
        if price_monthly       is not None: payload["price_monthly"]       = price_monthly
        if records_per_month   is not None: payload["records_per_month"]   = records_per_month
        if api_keys_limit      is not None: payload["api_keys_limit"]      = api_keys_limit
        if diagnoses_per_month is not None: payload["diagnoses_per_month"] = diagnoses_per_month
        if field_limit         is not None: payload["field_limit"]         = field_limit
        if workspaces_limit    is not None: payload["workspaces_limit"]    = workspaces_limit
        _http.patch(
            f"{_SUPABASE_URL}/rest/v1/enterprise_tiers",
            json=payload,
            params={"id": f"eq.{tier_id}"},
            headers={**_HEADERS, "Prefer": "return=minimal"}, timeout=10,
        ).raise_for_status()


# --- workspaces ---

def get_workspaces(tenant_id: str) -> list[dict]:
    """Returns all workspaces for a tenant."""
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/workspaces",
            params={"tenant_id": f"eq.{tenant_id}", "order": "created_at.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    return []


def get_workspace_by_id(workspace_id: int) -> dict | None:
    """Returns a workspace by ID."""
    if USE_SUPABASE:
        try:
            resp = _http.get(
                f"{_SUPABASE_URL}/rest/v1/workspaces",
                params={"id": f"eq.{workspace_id}"},
                headers=_HEADERS, timeout=10,
            )
            resp.raise_for_status()
            rows = resp.json()
            return rows[0] if rows else None
        except Exception:
            return None
    return None


def create_workspace(tenant_id: str, name: str, description: str = "") -> dict:
    """Creates a new workspace. Returns the created workspace."""
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/workspaces",
            json={"tenant_id": tenant_id, "name": name, "description": description, "is_default": False},
            headers={**_HEADERS, "Prefer": "return=representation"},
            timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else {}
    return {}


def update_workspace(tenant_id: str, workspace_id: int, name: str, description: str = "") -> dict | None:
    """Updates a workspace name and description."""
    if USE_SUPABASE:
        resp = _http.patch(
            f"{_SUPABASE_URL}/rest/v1/workspaces",
            json={"name": name, "description": description},
            params={"id": f"eq.{workspace_id}", "tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=representation"},
            timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None
    return None


def delete_workspace(tenant_id: str, workspace_id: int) -> bool:
    """Deletes a workspace. Returns True if deleted."""
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/workspaces",
            params={"id": f"eq.{workspace_id}", "tenant_id": f"eq.{tenant_id}"},
            headers={**_HEADERS, "Prefer": "return=representation"},
            timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json()) > 0
    return False


def get_workspace_members(workspace_id: int) -> list[dict]:
    """Returns all members of a workspace."""
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/workspace_members",
            params={"workspace_id": f"eq.{workspace_id}", "order": "created_at.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    return []


def add_workspace_member(workspace_id: int, tenant_id: str, email: str, role: str, invited_by: str) -> dict:
    """Adds a member to a workspace. Returns the created record."""
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/workspace_members",
            json={"workspace_id": workspace_id, "tenant_id": tenant_id, "email": email, "role": role, "invited_by": invited_by},
            headers={**_HEADERS, "Prefer": "return=representation"},
            timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else {}
    return {}


def update_workspace_member_role(workspace_id: int, email: str, role: str) -> None:
    """Updates a member's role in a workspace."""
    if USE_SUPABASE:
        _http.patch(
            f"{_SUPABASE_URL}/rest/v1/workspace_members",
            json={"role": role},
            params={"workspace_id": f"eq.{workspace_id}", "email": f"eq.{email}"},
            headers={**_HEADERS, "Prefer": "return=minimal"},
            timeout=10,
        ).raise_for_status()


def remove_workspace_member(workspace_id: int, email: str) -> None:
    """Removes a member from a workspace."""
    if USE_SUPABASE:
        _http.delete(
            f"{_SUPABASE_URL}/rest/v1/workspace_members",
            params={"workspace_id": f"eq.{workspace_id}", "email": f"eq.{email}"},
            headers=_HEADERS, timeout=10,
        ).raise_for_status()


def get_workspaces_limit(plan_name: str, tenant_id: str | None = None) -> int:
    """Returns the workspace limit for a plan. For enterprise, resolves tier-specific limit."""
    if plan_name == "enterprise" and tenant_id:
        tier = get_enterprise_tier_for_tenant(tenant_id)
        if tier:
            return tier.get("workspaces_limit", 999)
    configs = get_plan_configs()
    cfg = next((c for c in configs if c["plan_name"] == plan_name), None)
    if cfg:
        return cfg.get("workspaces_limit", 1)
    return 1


# --- admin_secrets ---

def upsert_secret(key_name: str, encrypted_value: str) -> None:
    if USE_SUPABASE:
        _http.post(
            f"{_SUPABASE_URL}/rest/v1/admin_secrets",
            json={"key_name": key_name, "encrypted": encrypted_value,
                  "updated_at": datetime.now(timezone.utc).isoformat()},
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "key_name"}, timeout=10,
        ).raise_for_status()
        return
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS admin_secrets (
                key_name   TEXT PRIMARY KEY,
                encrypted  TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute(
            "INSERT INTO admin_secrets (key_name, encrypted) VALUES (?, ?)"
            " ON CONFLICT(key_name) DO UPDATE SET encrypted=excluded.encrypted, updated_at=CURRENT_TIMESTAMP",
            (key_name, encrypted_value),
        )


def list_secrets() -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/admin_secrets",
            params={"select": "key_name,updated_at", "order": "key_name.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(
                "SELECT key_name, updated_at FROM admin_secrets ORDER BY key_name"
            ).fetchall()]
    return []


def get_secret_encrypted(key_name: str) -> str | None:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/admin_secrets",
            params={"select": "encrypted", "key_name": f"eq.{key_name}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0]["encrypted"] if rows else None
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            row = conn.execute(
                "SELECT encrypted FROM admin_secrets WHERE key_name = ?", (key_name,)
            ).fetchone()
            return row[0] if row else None
    return None


def delete_secret(key_name: str) -> int:
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/admin_secrets",
            params={"key_name": f"eq.{key_name}"},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            return conn.execute(
                "DELETE FROM admin_secrets WHERE key_name = ?", (key_name,)
            ).rowcount
    return 0


def list_tenants() -> list[dict]:
    """Lists all registered tenants with company name (admin view)."""
    if not USE_SUPABASE:
        return []
    try:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenants",
            params={"select": "tenant_id,company_name,plan,subscription_status",
                    "order": "company_name.asc.nullslast"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning("list_tenants failed: %s", e)
        return []


# --- enterprise_client_configs ---

def get_enterprise_config(tenant_id: str) -> dict | None:
    """Returns custom Enterprise config for this tenant, or None if not configured."""
    if not USE_SUPABASE:
        return None
    try:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/enterprise_client_configs",
            params={"select": "tenant_id,stripe_price_id,amount_display,currency_display",
                    "tenant_id": f"eq.{tenant_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None
    except Exception as e:
        logger.warning("get_enterprise_config failed: %s", e)
        return None


def upsert_enterprise_config(
    tenant_id: str, stripe_price_id: str, amount_display: float, currency_display: str = "BRL"
) -> dict:
    """Creates or updates a custom Enterprise config for a tenant."""
    if not USE_SUPABASE:
        return {}
    payload = {
        "tenant_id": tenant_id,
        "stripe_price_id": stripe_price_id,
        "amount_display": amount_display,
        "currency_display": currency_display.upper(),
    }
    resp = _http.post(
        f"{_SUPABASE_URL}/rest/v1/enterprise_client_configs",
        json=payload,
        headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
        params={"on_conflict": "tenant_id"}, timeout=10,
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else payload


def delete_enterprise_config(tenant_id: str) -> int:
    """Removes custom Enterprise config for a tenant."""
    if not USE_SUPABASE:
        return 0
    resp = _http.delete(
        f"{_SUPABASE_URL}/rest/v1/enterprise_client_configs",
        params={"tenant_id": f"eq.{tenant_id}"},
        headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
    )
    resp.raise_for_status()
    return len(resp.json())


def list_enterprise_configs() -> list[dict]:
    """Lists all enterprise client configs (admin view)."""
    if not USE_SUPABASE:
        return []
    try:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/enterprise_client_configs",
            params={"select": "tenant_id,stripe_price_id,amount_display,currency_display,created_at",
                    "order": "created_at.desc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning("list_enterprise_configs failed: %s", e)
        return []


def sync_stripe_plans(stripe_secret_key: str) -> list[dict]:
    """Syncs plan configs from Stripe: iterates products, finds plan_name metadata, picks latest price."""
    import stripe as _stripe
    _stripe.api_key = stripe_secret_key

    updated = []
    products = _stripe.Product.list(active=True, limit=100)
    for product in products.auto_paging_iter():
        try:
            raw_meta = getattr(product, "metadata", None)
            try:
                meta: dict = dict(raw_meta) if raw_meta else {}
            except Exception:
                meta = {}
            plan_name = meta.get("plan_name")
            if not plan_name:
                continue

            # Get the most recently created active price for this product
            product_prices = _stripe.Price.list(product=product.id, active=True, limit=10)
            best_price = None
            for price in product_prices.auto_paging_iter():
                price_created = getattr(price, "created", 0) or 0
                if best_price is None or price_created > (getattr(best_price, "created", 0) or 0):
                    best_price = price

            if not best_price:
                continue

            amount = (getattr(best_price, "unit_amount", None) or 0) / 100.0
            field_limit = get_plan_field_limit(plan_name)
            upsert_plan_config(plan_name, field_limit, amount, best_price.id)
            updated.append({
                "plan_name": plan_name,
                "stripe_price_id": best_price.id,
                "price_monthly": amount,
            })
        except Exception as exc:
            logger.warning("sync_stripe_plans: skipping product %s — %s", getattr(product, "id", "?"), exc)
            continue

    return updated


# --- tenant_members ---

def get_tenant_member_by_email(tenant_id: str, email: str) -> dict | None:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_members",
            params={"select": "id,email,role,invited_by,created_at",
                    "tenant_id": f"eq.{tenant_id}", "email": f"eq.{email}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT id, email, role, invited_by, created_at FROM tenant_members WHERE tenant_id = ? AND email = ?",
                (tenant_id, email),
            ).fetchone()
            return dict(row) if row else None
    return None


def list_tenant_members(tenant_id: str) -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_members",
            params={"select": "id,email,role,invited_by,created_at",
                    "tenant_id": f"eq.{tenant_id}", "order": "created_at.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(
                "SELECT id, email, role, invited_by, created_at FROM tenant_members WHERE tenant_id = ? ORDER BY created_at",
                (tenant_id,),
            ).fetchall()]
    return []


def add_tenant_member(tenant_id: str, email: str, role: str, invited_by: str) -> dict:
    payload = {"tenant_id": tenant_id, "email": email, "role": role, "invited_by": invited_by}
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/tenant_members",
            json=payload,
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
            params={"on_conflict": "tenant_id,email"}, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else payload
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO tenant_members (tenant_id, email, role, invited_by) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(tenant_id, email) DO UPDATE SET role=excluded.role, invited_by=excluded.invited_by",
            (tenant_id, email, role, invited_by),
        )
    return payload


def update_tenant_member_role(tenant_id: str, email: str, role: str) -> int:
    if USE_SUPABASE:
        resp = _http.patch(
            f"{_SUPABASE_URL}/rest/v1/tenant_members",
            json={"role": role},
            params={"tenant_id": f"eq.{tenant_id}", "email": f"eq.{email}"},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            return conn.execute(
                "UPDATE tenant_members SET role = ? WHERE tenant_id = ? AND email = ?",
                (role, tenant_id, email),
            ).rowcount
    return 0


def remove_tenant_member(tenant_id: str, email: str) -> int:
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/tenant_members",
            params={"tenant_id": f"eq.{tenant_id}", "email": f"eq.{email}"},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            return conn.execute(
                "DELETE FROM tenant_members WHERE tenant_id = ? AND email = ?",
                (tenant_id, email),
            ).rowcount
    return 0


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
