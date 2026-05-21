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
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at   TIMESTAMP DEFAULT (datetime('now', '+90 days'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS review_queue (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id    TEXT NOT NULL DEFAULT 'default',
                name         TEXT NOT NULL,
                email        TEXT,
                cpf          TEXT,
                extra_fields TEXT DEFAULT '{}',
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
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
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(tenant_id, field_key)
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


# --- clean_records ---

def save(record: dict, tenant_id: str = "default") -> None:
    extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf")}
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/clean_records",
            json={"tenant_id": tenant_id, "name": record["name"], "email": record["email"],
                  "cpf": record["cpf"], "extra_fields": extra or {}},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO clean_records (tenant_id, name, email, cpf, extra_fields) VALUES (?, ?, ?, ?, ?)",
            (tenant_id, record["name"], record["email"], record["cpf"], json.dumps(extra)),
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
    extra = {k: v for k, v in record.items() if k not in ("name", "email", "cpf")}
    if USE_SUPABASE:
        resp = _http.post(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            json={"tenant_id": tenant_id, "name": record["name"], "email": record.get("email"),
                  "cpf": record.get("cpf"), "extra_fields": extra or {}},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO review_queue (tenant_id, name, email, cpf, extra_fields) VALUES (?, ?, ?, ?, ?)",
            (tenant_id, record["name"], record.get("email"), record.get("cpf"), json.dumps(extra)),
        )


def get_queue(tenant_id: str = "default") -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/review_queue",
            params={"select": "name,email,cpf,extra_fields", "order": "id.asc", "tenant_id": f"eq.{tenant_id}"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT name, email, cpf, extra_fields FROM review_queue WHERE tenant_id = ? ORDER BY id", (tenant_id,)
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
) -> None:
    """Writes an immutable compliance event. Never raises — audit must not break the main flow."""
    payload = fields_affected or {}
    try:
        if USE_SUPABASE:
            _http.post(
                f"{_SUPABASE_URL}/rest/v1/tenant_audit_logs",
                json={
                    "tenant_id": tenant_id,
                    "operator_email": operator_email,
                    "record_name": record_name,
                    "action": action,
                    "fields_affected": payload,
                },
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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute(
                "INSERT INTO tenant_audit_logs (tenant_id, operator_email, record_name, action, fields_affected)"
                " VALUES (?, ?, ?, ?, ?)",
                (tenant_id, operator_email, record_name, action, json.dumps(payload)),
            )
    except Exception as exc:
        logger.warning("create_audit_log failed (non-fatal): %s", exc)


def list_audit_logs(tenant_id: str, limit: int = 100) -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_audit_logs",
            params={
                "select": "id,operator_email,record_name,action,fields_affected,created_at",
                "tenant_id": f"eq.{tenant_id}",
                "order": "created_at.desc",
                "limit": limit,
            },
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(
                "SELECT id, operator_email, record_name, action, fields_affected, created_at"
                " FROM tenant_audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
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


# --- tenant_field_schemas ---

_DEFAULT_SCHEMA: list[dict] = [
    {"field_key": "email", "label": "E-mail",   "field_type": "email", "required": True,  "position": 1, "validation_rules": {}},
    {"field_key": "cpf",   "label": "CPF/CNPJ", "field_type": "cpf",   "required": True,  "position": 2, "validation_rules": {}},
]

PLAN_LIMITS: dict[str, int] = {
    "starter":    5,
    "pro":        15,
    "enterprise": 999,
}


def _merge_with_defaults(custom_rows: list[dict]) -> list[dict]:
    """Always includes _DEFAULT_SCHEMA fields; custom rows override defaults for same key."""
    merged = {f["field_key"]: dict(f) for f in _DEFAULT_SCHEMA}
    for row in custom_rows:
        merged[row["field_key"]] = row
    return sorted(merged.values(), key=lambda f: f.get("position", 0))


def get_tenant_schema(tenant_id: str) -> list[dict]:
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            params={"select": "field_key,label,field_type,required,position,validation_rules",
                    "tenant_id": f"eq.{tenant_id}", "order": "position.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return _merge_with_defaults(rows)
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT field_key, label, field_type, required, position, validation_rules"
                " FROM tenant_field_schemas WHERE tenant_id = ? ORDER BY position",
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
                custom.append(d)
            return _merge_with_defaults(custom)
    return list(_DEFAULT_SCHEMA)


def upsert_field_schema(tenant_id: str, field: dict) -> None:
    if USE_SUPABASE:
        _http.post(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            json={"tenant_id": tenant_id, **field},
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "tenant_id,field_key"}, timeout=10,
        ).raise_for_status()
        return
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(_DB_PATH) as conn:
        conn.execute(
            "INSERT INTO tenant_field_schemas (tenant_id, field_key, label, field_type, required, position, validation_rules)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(tenant_id, field_key) DO UPDATE SET"
            " label=excluded.label, field_type=excluded.field_type, required=excluded.required,"
            " position=excluded.position, validation_rules=excluded.validation_rules",
            (tenant_id, field["field_key"], field["label"], field["field_type"],
             1 if field.get("required", True) else 0, field.get("position", 0),
             json.dumps(field.get("validation_rules", {}))),
        )


def get_tenant_plan(tenant_id: str) -> str:
    """Returns the tenant's plan name ('starter', 'pro', 'enterprise'). Defaults to 'starter'."""
    if USE_SUPABASE:
        try:
            resp = _http.get(
                f"{_SUPABASE_URL}/rest/v1/tenants",
                params={"select": "plan", "id": f"eq.{tenant_id}"},
                headers=_HEADERS, timeout=10,
            )
            resp.raise_for_status()
            rows = resp.json()
            return (rows[0].get("plan") or "starter") if rows else "starter"
        except Exception:
            return "starter"
    return "starter"


_DEFAULT_KEYS = {f["field_key"] for f in _DEFAULT_SCHEMA}


def count_field_schemas(tenant_id: str) -> int:
    """Counts only non-default custom fields (email and cpf are free baseline, never counted)."""
    excluded = ",".join(f'"{k}"' for k in _DEFAULT_KEYS)
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            params={"select": "id", "tenant_id": f"eq.{tenant_id}",
                    "field_key": f"not.in.({','.join(_DEFAULT_KEYS)})"},
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
            row = conn.execute(
                f"SELECT COUNT(*) FROM tenant_field_schemas WHERE tenant_id = ? AND field_key NOT IN ({placeholders})",
                (tenant_id, *_DEFAULT_KEYS),
            ).fetchone()
            return row[0] if row else 0
    return 0


def delete_field_schema(tenant_id: str, field_key: str) -> int:
    if field_key in ("name",):
        return 0  # name is always required — cannot be removed
    if USE_SUPABASE:
        resp = _http.delete(
            f"{_SUPABASE_URL}/rest/v1/tenant_field_schemas",
            params={"tenant_id": f"eq.{tenant_id}", "field_key": f"eq.{field_key}"},
            headers={**_HEADERS, "Prefer": "return=representation"}, timeout=10,
        )
        resp.raise_for_status()
        return len(resp.json())
    if _DB_PATH.exists():
        with sqlite3.connect(_DB_PATH) as conn:
            return conn.execute(
                "DELETE FROM tenant_field_schemas WHERE tenant_id = ? AND field_key = ?",
                (tenant_id, field_key)
            ).rowcount
    return 0


# --- admin_plan_configs ---

def get_plan_configs() -> list[dict]:
    defaults = [
        {"plan_name": "starter",    "field_limit": PLAN_LIMITS["starter"],    "price_monthly": 0.0,  "stripe_price_id": None},
        {"plan_name": "pro",        "field_limit": PLAN_LIMITS["pro"],        "price_monthly": 49.0, "stripe_price_id": None},
        {"plan_name": "enterprise", "field_limit": PLAN_LIMITS["enterprise"], "price_monthly": 199.0,"stripe_price_id": None},
    ]
    if USE_SUPABASE:
        resp = _http.get(
            f"{_SUPABASE_URL}/rest/v1/admin_plan_configs",
            params={"select": "plan_name,field_limit,price_monthly,stripe_price_id", "order": "plan_name.asc"},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows if rows else defaults
    return defaults


def upsert_plan_config(plan_name: str, field_limit: int, price_monthly: float, stripe_price_id: str | None) -> None:
    PLAN_LIMITS[plan_name] = field_limit
    if USE_SUPABASE:
        _http.post(
            f"{_SUPABASE_URL}/rest/v1/admin_plan_configs",
            json={"plan_name": plan_name, "field_limit": field_limit,
                  "price_monthly": price_monthly, "stripe_price_id": stripe_price_id,
                  "updated_at": datetime.now(timezone.utc).isoformat()},
            headers={**_HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "plan_name"}, timeout=10,
        ).raise_for_status()


def get_plan_field_limit(plan_name: str) -> int:
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
