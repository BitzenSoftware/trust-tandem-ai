import base64
import json
from cryptography.fernet import Fernet, InvalidToken
import os
import re
import sys
import time
from collections import defaultdict, deque
from pathlib import Path
from threading import Lock

sys.path.insert(0, str(Path(__file__).parent))

import anthropic
import requests as _req
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

import repository
from app_orquestrador import PainelOrquestracao, _hint

AGENTS_DIR = Path(__file__).parent.parent / "agents"

_SUPABASE_URL      = os.environ.get("SUPABASE_URL",      "https://szmxignwhckydwjmrwxs.supabase.co")
_SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "sb_publishable_jA1KNrUNIWuwSKcK3bT1JQ_DzfmYS3B")
_API_KEY           = os.environ.get("API_GATEWAY_KEY", "")
_bearer      = HTTPBearer(auto_error=False)
_key_scheme  = APIKeyHeader(name="X-API-Key", auto_error=False)

_startup_logger = __import__("logging").getLogger("uvicorn.error")
if not _API_KEY:
    _startup_logger.warning(
        "SEGURANÇA: API_GATEWAY_KEY não configurada — modo dev ativo."
    )
else:
    _startup_logger.info("API_GATEWAY_KEY configurada — autenticação ativa.")


_SUPER_ADMIN_EMAIL = os.environ.get("SUPER_ADMIN_EMAIL", "bitzensoftware@bitzen.app")

_MASTER_KEY_RAW = os.environ.get("MASTER_ENCRYPTION_KEY", "")
try:
    _fernet: Fernet | None = Fernet(_MASTER_KEY_RAW.encode()) if _MASTER_KEY_RAW else None
except Exception:
    _fernet = None


def _encrypt(value: str) -> str:
    if not _fernet:
        raise HTTPException(status_code=503, detail="MASTER_ENCRYPTION_KEY não configurada no servidor.")
    return _fernet.encrypt(value.encode()).decode()


def _decrypt(encrypted: str) -> str:
    if not _fernet:
        raise HTTPException(status_code=503, detail="MASTER_ENCRYPTION_KEY não configurada no servidor.")
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except InvalidToken:
        raise HTTPException(status_code=500, detail="Falha ao desencriptar. Chave mestra inválida ou dados corrompidos.")


def _get_tenant_id(
    creds: HTTPAuthorizationCredentials | None = Security(_bearer),
    api_key: str | None = Security(_key_scheme),
) -> str:
    """Aceita Bearer JWT (Next.js) ou X-API-Key (Streamlit/legado)."""
    if creds:
        try:
            resp = _req.get(
                f"{_SUPABASE_URL}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {creds.credentials}",
                    "apikey": _SUPABASE_ANON_KEY,
                },
                timeout=10,
            )
        except _req.RequestException:
            raise HTTPException(status_code=503, detail="Não foi possível contactar o Supabase.")
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail=f"Token inválido ({resp.status_code}).")
        user_data = resp.json()
        user_meta = user_data.get("user_metadata", {})
        email     = user_data.get("email", "")

        # Super admin: acesso irrestrito com tenant especial
        if user_meta.get("is_super_admin") or email == _SUPER_ADMIN_EMAIL:
            return "__admin__"

        tenant_id = user_meta.get("tenant_id")
        if not tenant_id:
            raise HTTPException(status_code=403, detail="Tenant não configurado para este utilizador.")
        return str(tenant_id)

    if api_key:
        tenant_id = repository.validate_api_key(api_key)
        if tenant_id:
            return tenant_id
        if _API_KEY and api_key == _API_KEY:
            return "default"
        raise HTTPException(status_code=401, detail="API Key inválida.")

    if not _API_KEY:
        return "default"

    raise HTTPException(status_code=401, detail="Autenticação necessária.")


_claude = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-6"


def _load_prompt(name: str) -> str:
    return (AGENTS_DIR / f"{name}.txt").read_text(encoding="utf-8")


def _call_claude(system: str, message: str) -> str:
    resp = _claude.messages.create(
        model=MODEL, max_tokens=512, system=system,
        messages=[{"role": "user", "content": message}],
    )
    return resp.content[0].text


def _get_painel(tenant_id: str = Depends(_get_tenant_id)) -> PainelOrquestracao:
    if tenant_id != "__admin__":
        sub = repository.get_tenant_subscription(tenant_id)
        if sub.get("status") == "expired":
            raise HTTPException(
                status_code=402,
                detail="Trial de 15 dias expirado. Assine um plano para continuar.",
            )
    return PainelOrquestracao(tenant_id=tenant_id)


# Max requests per 60s window, keyed by effective_plan
_PLAN_RATE_LIMITS: dict[str, int] = {
    "starter":      20,
    "pro":          60,
    "professional": 200,
    "enterprise":   1000,
}
_RATE_WINDOW = 60
_PLAN_CACHE_TTL = 300  # seconds — re-fetch plan at most every 5 min


class _TenantRateLimiter:
    """Sliding-window rate limiter per tenant, respecting per-plan limits."""

    def __init__(self) -> None:
        self._buckets: dict[str, deque] = defaultdict(deque)
        self._plan_cache: dict[str, tuple[str, float]] = {}
        self._lock = Lock()

    def _resolve_plan(self, tenant_id: str) -> str:
        now = time.monotonic()
        with self._lock:
            cached = self._plan_cache.get(tenant_id)
            if cached and (now - cached[1]) < _PLAN_CACHE_TTL:
                return cached[0]
        try:
            sub = repository.get_tenant_subscription(tenant_id)
            plan = sub.get("effective_plan", "starter")
        except Exception:
            plan = "starter"
        with self._lock:
            self._plan_cache[tenant_id] = (plan, time.monotonic())
        return plan

    def check(self, tenant_id: str) -> None:
        plan = self._resolve_plan(tenant_id)
        max_req = _PLAN_RATE_LIMITS.get(plan, 20)
        now = time.monotonic()
        cutoff = now - _RATE_WINDOW
        with self._lock:
            dq = self._buckets[tenant_id]
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= max_req:
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit: máximo {max_req} req/{_RATE_WINDOW}s (plano {plan}).",
                    headers={"Retry-After": str(_RATE_WINDOW)},
                )
            dq.append(now)


_rate_limiter = _TenantRateLimiter()


def _rate_limit(tenant_id: str = Depends(_get_tenant_id)) -> None:
    _rate_limiter.check(tenant_id)


def _decode_jwt_email(token: str) -> str:
    """Extracts email from JWT payload without re-verifying (already validated by Supabase)."""
    try:
        segment = token.split(".")[1]
        segment += "=" * (4 - len(segment) % 4)
        payload = json.loads(base64.b64decode(segment))
        return payload.get("email", "")
    except Exception:
        return ""


def _get_operator_email(
    creds: HTTPAuthorizationCredentials | None = Security(_bearer),
    api_key: str | None = Security(_key_scheme),
) -> str:
    if creds:
        return _decode_jwt_email(creds.credentials) or "jwt-user"
    if api_key:
        tenant_id = repository.validate_api_key(api_key)
        return f"api-key:{tenant_id or 'gateway'}"
    return "system"


def _require_super_admin(tenant_id: str = Depends(_get_tenant_id)) -> str:
    if tenant_id != "__admin__":
        raise HTTPException(status_code=403, detail="Acesso restrito ao super administrador.")
    return tenant_id


app = FastAPI(
    title="Trust & Tandem AI Gateway",
    description="API segura de ingestão de dados em conformidade com LGPD — Orquestração Humano-IA",
    version="2.0.0",
    docs_url=None if _API_KEY else "/docs",
    redoc_url=None if _API_KEY else "/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", include_in_schema=False)
def health():
    import repository as _repo
    return {"status": "ok", "storage": "supabase" if _repo.USE_SUPABASE else "sqlite"}


_router = APIRouter(prefix="/api/v1", dependencies=[Depends(_get_tenant_id)])


# --- SCHEMAS ---

class ClienteInput(BaseModel):
    model_config = {"extra": "allow"}
    name: str = Field(..., examples=["João Errado"])
    email: Optional[str] = Field(None, examples=["joao.silva.com"])
    cpf: Optional[str] = Field(None, examples=["123.ABC.789-XX"])
    legal_basis: Optional[str] = Field(None, examples=["consentimento"], description="LGPD Art. 11 — base legal para tratamento (ex: consentimento, obrigação_legal)")


class FieldSchemaIn(BaseModel):
    field_key: str
    label: str
    field_type: str = "text"
    required: bool = True
    position: int = 0
    validation_rules: Optional[dict] = None
    is_sensitive: bool = False


class RespostaIngestao(BaseModel):
    status: str
    mensagem: str
    registros_banco_limpo: int
    registros_fila_revisao: int


class RegistroMascaradoOut(BaseModel):
    name: str
    email: str
    cpf: str


class RegistroRevisaoOut(BaseModel):
    name: str
    email_hint: str
    cpf_hint: str
    legal_basis: Optional[str] = None


class DiagnosticoOut(BaseModel):
    name: str
    campo_afetado: str
    valor_original: str
    valor_sugerido: str
    diagnostico_motivo: str


class ApiKeyCreate(BaseModel):
    label: Optional[str] = None


class ApiKeyOut(BaseModel):
    id: int
    label: Optional[str] = None
    created_at: str
    key: Optional[str] = None


class WebhookIn(BaseModel):
    url: str


class WebhookOut(BaseModel):
    url: str
    secret: str
    active: bool


class BulkResolveItem(BaseModel):
    name: str
    email: Optional[str] = None
    cpf: Optional[str] = None


class BulkResolveInput(BaseModel):
    items: list[BulkResolveItem]
    mode: str = "auto"  # "auto" skips items without a valid suggestion; "all" forces resolve


class BulkResolveDetail(BaseModel):
    name: str
    status: str  # "success" | "skipped" | "error"
    detail: Optional[str] = None


class BulkResolveReport(BaseModel):
    approved: int
    skipped: int
    errors: int
    webhooks_fired: int
    details: list[BulkResolveDetail]


class PlanConfigIn(BaseModel):
    field_limit: int
    price_monthly: float = 0.0
    stripe_price_id: Optional[str] = None


class SecretIn(BaseModel):
    key_name: str
    value: str


class CheckoutIn(BaseModel):
    plan_name: str


class EnterpriseClientIn(BaseModel):
    tenant_id: str
    stripe_price_id: str
    amount_display: float
    currency_display: str = "BRL"


def _get_stripe_key() -> str:
    """Returns Stripe secret key from env var or encrypted vault."""
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key:
        try:
            enc = repository.get_secret_encrypted("STRIPE_SECRET_KEY")
            if enc:
                key = _decrypt(enc)
        except Exception:
            pass
    return key


# --- ROTAS ---

@_router.post("/ingest", response_model=RespostaIngestao, status_code=status.HTTP_202_ACCEPTED,
              summary="Ingere lote de clientes e separa anomalias para revisão humana",
              dependencies=[Depends(_rate_limit)])
def ingerir_dados(clientes: list[ClienteInput], painel: PainelOrquestracao = Depends(_get_painel)):
    if not clientes:
        raise HTTPException(status_code=400, detail="A lista de clientes não pode estar vazia.")
    schema = repository.get_tenant_schema(painel.tenant_id)
    clean_count, queue_count = painel.processar_lote(
        [c.model_dump() for c in clientes], schema=schema
    )
    return RespostaIngestao(
        status="Processado",
        mensagem="Lote avaliado pela IA de Compliance.",
        registros_banco_limpo=clean_count,
        registros_fila_revisao=queue_count,
    )


@_router.get("/review-queue", response_model=list[RegistroRevisaoOut],
             summary="Lista registros aguardando intervenção humana")
def listar_fila_revisao(painel: PainelOrquestracao = Depends(_get_painel)):
    return [
        RegistroRevisaoOut(
            name=item["name"],
            email_hint=_hint(str(item.get("email", ""))),
            cpf_hint=_hint(str(item.get("cpf", ""))),
            legal_basis=item.get("legal_basis"),
        )
        for item in painel.fila_revisao
    ]


@_router.get("/database", summary="Retorna dados mascarados no display — dados reais no CSV/webhook")
def visualizar_banco_seguro(
    painel: PainelOrquestracao = Depends(_get_painel),
    limit: int = Query(default=500, ge=1, le=1000, description="Registros por página (máx 1000)"),
    after_id: Optional[int] = Query(default=None, description="Cursor: ID do último registo recebido"),
):
    from masking import mask_email, mask_cpf
    records, next_cursor = repository.get_clean_records_paginated(painel.tenant_id, after_id, limit)
    masked = [{"name": r["name"], "email": mask_email(r["email"]), "cpf": mask_cpf(r["cpf"])} for r in records]
    headers: dict[str, str] = {"X-Has-More": "true" if next_cursor is not None else "false"}
    if next_cursor is not None:
        headers["X-Next-Cursor"] = str(next_cursor)
    return JSONResponse(content=masked, headers=headers)


@_router.get("/database/count", summary="Retorna contagem total de registros limpos do tenant")
def contar_banco(painel: PainelOrquestracao = Depends(_get_painel)):
    return {"count": repository.count_clean_records(painel.tenant_id)}


@_router.get("/database/export", summary="Exporta dados limpos como CSV — suporta split em partes")
def exportar_csv(
    painel: PainelOrquestracao = Depends(_get_painel),
    limit: int = Query(default=10000, ge=100, le=50000, description="Registros por arquivo (100–50 000)"),
    after_id: Optional[int] = Query(default=None, description="Cursor: ID do último registro da parte anterior"),
):
    import csv
    import io
    from datetime import date

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["name", "email", "cpf"])
    writer.writeheader()

    collected = 0
    cursor = after_id
    next_cursor = None
    BATCH = 1000

    while collected < limit:
        batch = min(BATCH, limit - collected)
        page, nc = repository.get_clean_records_paginated(painel.tenant_id, cursor, batch)
        for row in page:
            writer.writerow({"name": row["name"], "email": row["email"], "cpf": row["cpf"]})
        collected += len(page)
        cursor = nc
        next_cursor = nc
        if nc is None:
            break

    today = date.today().isoformat()
    content = ("﻿" + buf.getvalue()).encode("utf-8")
    resp_headers: dict[str, str] = {
        "Content-Disposition": f'attachment; filename="trust-tandem-{today}.csv"',
        "X-Has-More": "true" if next_cursor is not None else "false",
    }
    if next_cursor is not None:
        resp_headers["X-Next-Cursor"] = str(next_cursor)
    return Response(content=content, media_type="text/csv; charset=utf-8", headers=resp_headers)


@_router.post("/resolve", response_model=RespostaIngestao,
              summary="Submete correção humana para um registro da fila")
def resolver_registro(
    cliente: ClienteInput,
    painel: PainelOrquestracao = Depends(_get_painel),
    operator_email: str = Depends(_get_operator_email),
):
    before = len(painel.banco_limpo)
    original = next((r for r in painel.fila_revisao if r["name"] == cliente.name), {})
    merged = {
        "name":  cliente.name,
        "email": cliente.email if cliente.email is not None else original.get("email"),
        "cpf":   cliente.cpf   if cliente.cpf   is not None else original.get("cpf"),
    }
    painel.remover_da_fila(cliente.name)
    painel.resolver_direto(merged)
    after_records = painel.banco_limpo
    if len(after_records) > before:
        wh = repository.get_webhook(painel.tenant_id)
        if wh and wh.get("active"):
            repository.fire_webhook(wh["url"], wh["secret"], after_records[-1:])
    original_legal_basis = original.get("legal_basis") or cliente.legal_basis
    repository.create_audit_log(
        tenant_id=painel.tenant_id,
        operator_email=operator_email,
        record_name=cliente.name,
        action="APPROVE_MANUAL",
        fields_affected={
            "email_provided": cliente.email is not None,
            "cpf_provided": cliente.cpf is not None,
            **({"legal_basis": original_legal_basis} if original_legal_basis else {}),
        },
    )
    return RespostaIngestao(
        status="Resolvido",
        mensagem=f"Registro '{cliente.name}' reprocessado com dados corrigidos.",
        registros_banco_limpo=len(after_records),
        registros_fila_revisao=len(painel.fila_revisao),
    )


@_router.post("/bulk-resolve", response_model=BulkResolveReport,
              summary="Resolve em lote registros da fila — único round-trip HTTP, N operações DB")
def bulk_resolver(
    payload: BulkResolveInput,
    painel: PainelOrquestracao = Depends(_get_painel),
    operator_email: str = Depends(_get_operator_email),
):
    queue_index = {r["name"]: r for r in painel.fila_revisao}
    wh = repository.get_webhook(painel.tenant_id)
    approved = skipped = errors = webhooks_fired = 0
    details: list[BulkResolveDetail] = []
    approved_records: list[dict] = []

    for item in payload.items:
        original = queue_index.get(item.name)
        if not original:
            errors += 1
            details.append(BulkResolveDetail(name=item.name, status="error", detail="Não encontrado na fila"))
            continue

        merged = {
            "name":  item.name,
            "email": item.email if item.email is not None else original.get("email"),
            "cpf":   item.cpf   if item.cpf   is not None else original.get("cpf"),
        }

        has_valid_fix = (item.email is not None and item.email not in ("", "—")) \
                     or (item.cpf   is not None and item.cpf   not in ("", "—"))

        if not has_valid_fix and payload.mode == "auto":
            skipped += 1
            details.append(BulkResolveDetail(name=item.name, status="skipped", detail="sem sugestão automática"))
            continue

        # resolver_direto bypasses re-queue validation — AI/human approval is trusted
        painel.remover_da_fila(item.name)
        painel.resolver_direto(merged)

        approved += 1
        from masking import mask_email, mask_cpf
        approved_records.append({
            "name": merged["name"],
            "email": mask_email(merged.get("email") or ""),
            "cpf":   mask_cpf(merged.get("cpf") or ""),
        })
        details.append(BulkResolveDetail(
            name=item.name, status="success",
            detail=f"email={merged['email']}" if item.email else f"cpf={merged['cpf']}"
        ))
        item_legal_basis = original.get("legal_basis")
        repository.create_audit_log(
            tenant_id=painel.tenant_id,
            operator_email=operator_email,
            record_name=item.name,
            action="APPROVE_BULK",
            fields_affected={
                "email_provided": item.email is not None,
                "cpf_provided": item.cpf is not None,
                **({"legal_basis": item_legal_basis} if item_legal_basis else {}),
            },
        )

    if approved_records and wh and wh.get("active"):
        repository.fire_webhook(wh["url"], wh["secret"], approved_records)
        webhooks_fired = len(approved_records)

    return BulkResolveReport(
        approved=approved, skipped=skipped, errors=errors,
        webhooks_fired=webhooks_fired, details=details,
    )


@_router.post("/keys", response_model=ApiKeyOut, status_code=status.HTTP_201_CREATED,
              summary="Gera nova API Key para este tenant")
def criar_api_key(body: ApiKeyCreate, tenant_id: str = Depends(_get_tenant_id)):
    plain, key_id, created_at = repository.create_api_key(tenant_id, body.label)
    return ApiKeyOut(id=key_id, label=body.label, created_at=str(created_at), key=plain)


@_router.get("/keys", response_model=list[ApiKeyOut],
             summary="Lista API Keys do tenant")
def listar_api_keys(tenant_id: str = Depends(_get_tenant_id)):
    return [ApiKeyOut(**{**k, "key": None}) for k in repository.list_api_keys(tenant_id)]


@_router.delete("/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT,
                summary="Revoga uma API Key")
def revogar_api_key(key_id: int, tenant_id: str = Depends(_get_tenant_id)):
    if not repository.revoke_api_key(key_id, tenant_id):
        raise HTTPException(status_code=404, detail="API Key não encontrada.")


@_router.post("/webhook", response_model=WebhookOut,
              summary="Configura webhook de saída (upsert)")
def configurar_webhook(body: WebhookIn, tenant_id: str = Depends(_get_tenant_id)):
    secret = repository.save_webhook(tenant_id, body.url)
    return WebhookOut(url=body.url, secret=secret, active=True)


@_router.get("/webhook", response_model=WebhookOut,
             summary="Obtém configuração de webhook do tenant")
def obter_webhook(tenant_id: str = Depends(_get_tenant_id)):
    wh = repository.get_webhook(tenant_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Nenhum webhook configurado.")
    return WebhookOut(url=wh["url"], secret=wh["secret"], active=bool(wh.get("active", True)))


@_router.delete("/webhook", status_code=status.HTTP_204_NO_CONTENT,
                summary="Remove webhook do tenant")
def remover_webhook(tenant_id: str = Depends(_get_tenant_id)):
    repository.delete_webhook(tenant_id)


def _build_diagnosis_prompt(schema: list[dict]) -> str:
    fields_desc = "\n".join(
        f"- {f['label']} (field_key: \"{f['field_key']}\", type: {f['field_type']}"
        + (", DADO SENSÍVEL — valor não transmitido)" if f.get("is_sensitive") else ")")
        for f in schema
    )
    return (
        "Você é um especialista em validação de dados cadastrais.\n"
        "Analise o registro abaixo com base nos campos configurados pelo cliente:\n"
        f"{fields_desc}\n\n"
        "IMPORTANTE: campos marcados como DADO SENSÍVEL não recebem o valor real — "
        "não tente inferir ou sugerir valores para esses campos.\n\n"
        "Retorne EXCLUSIVAMENTE um objeto JSON válido, sem markdown:\n"
        "{\n"
        '  "campo_afetado": "<field_key do campo com problema>",\n'
        '  "valor_original": "<valor exato com o erro>",\n'
        '  "valor_sugerido": "<valor corrigido>",\n'
        '  "diagnostico_motivo": "<explicação concisa, máx. 2 linhas>"\n'
        "}"
    )


@_router.get("/analyze/{name}", summary="Diagnóstico estruturado Claude para um registro da fila",
             dependencies=[Depends(_rate_limit)])
def analisar_registro(name: str, painel: PainelOrquestracao = Depends(_get_painel)):
    record = next((r for r in painel.fila_revisao if r["name"] == name), None)
    if not record:
        raise HTTPException(status_code=404, detail=f"Registro '{name}' não encontrado na fila.")

    schema = repository.get_tenant_schema(painel.tenant_id)
    extra = record.get("extra_fields") or {}

    def _field_value(f: dict) -> str:
        if f.get("is_sensitive"):
            return "[DADO SENSÍVEL — omitido por segurança]"
        return record.get(f["field_key"]) or extra.get(f["field_key"], "") or ""

    field_lines = "\n".join(
        f"{f['label']}: {_field_value(f)}"
        for f in schema
    )
    user_msg = (
        f"Nome: {record['name']}\n"
        f"{field_lines}\n\n"
        "Identifique qual campo está inválido e retorne o JSON de diagnóstico."
    )
    raw = _call_claude(_build_diagnosis_prompt(schema), user_msg)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{[^{}]*\}', raw, re.DOTALL)
        data = json.loads(match.group()) if match else {
            "campo_afetado": "desconhecido",
            "valor_original": "",
            "valor_sugerido": "",
            "diagnostico_motivo": raw[:300],
        }

    payload = {
        "name": name,
        "campo_afetado":     data.get("campo_afetado", "desconhecido"),
        "valor_original":    data.get("valor_original", ""),
        "valor_sugerido":    data.get("valor_sugerido", ""),
        "diagnostico_motivo": data.get("diagnostico_motivo", ""),
    }
    return JSONResponse(content=payload, media_type="application/json; charset=utf-8")


@_router.delete("/review-queue/{name}", status_code=status.HTTP_204_NO_CONTENT,
                summary="Expurga um registro da fila (direito ao esquecimento LGPD)")
def expurgar_registro(
    name: str,
    painel: PainelOrquestracao = Depends(_get_painel),
    operator_email: str = Depends(_get_operator_email),
):
    deleted = painel.remover_da_fila(name)
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Registro '{name}' não encontrado na fila.")
    repository.create_audit_log(
        tenant_id=painel.tenant_id,
        operator_email=operator_email,
        record_name=name,
        action="EXPURGO",
        fields_affected={},
    )


@_router.delete("/admin/purge-expired",
                summary="LGPD Art. 15 — expurga registros da fila sem ação há mais de N dias")
def purgar_expirados(days: int = 30, tenant_id: str = Depends(_get_tenant_id)):
    scope = None if tenant_id == "__admin__" else tenant_id
    deleted = repository.purge_expired_queue(tenant_id=scope, days=days)
    if deleted > 0:
        repository.create_audit_log(
            tenant_id=scope or "__admin__",
            operator_email="system:purge-expired",
            record_name=f"__bulk_purge_{deleted}_records",
            action="PURGE_AUTO",
            fields_affected={"count": deleted, "days": days},
        )
    return {"deleted": deleted, "days": days, "scope": scope or "all"}


@_router.get("/audit-logs", summary="Logs de auditoria e compliance do tenant (ANPD)")
def listar_audit_logs(limit: int = 100, tenant_id: str = Depends(_get_tenant_id)):
    return repository.list_audit_logs(tenant_id=tenant_id, limit=min(limit, 500))


@_router.get("/schema", summary="Retorna o schema de campos do tenant")
def obter_schema(tenant_id: str = Depends(_get_tenant_id)):
    return repository.get_tenant_schema(tenant_id)


@_router.get("/admin/profile", summary="Retorna perfil e papel do utilizador autenticado")
def admin_profile(
    creds: HTTPAuthorizationCredentials | None = Security(_bearer),
    tenant_id: str = Depends(_get_tenant_id),
):
    email = _decode_jwt_email(creds.credentials) if creds else ""
    return {"is_super_admin": tenant_id == "__admin__", "email": email}


@_router.get("/admin/plans", summary="Lista configurações de planos [super admin]",
             dependencies=[Depends(_require_super_admin)])
def listar_planos_admin():
    return repository.get_plan_configs()


@_router.put("/admin/plans/{plan_name}", summary="Actualiza configuração de um plano [super admin]",
             dependencies=[Depends(_require_super_admin)])
def atualizar_plano(plan_name: str, body: PlanConfigIn):
    repository.upsert_plan_config(plan_name, body.field_limit, body.price_monthly, body.stripe_price_id)
    return repository.get_plan_configs()


@_router.get("/admin/secrets", summary="Lista chaves secretas armazenadas [super admin]",
             dependencies=[Depends(_require_super_admin)])
def listar_secrets_admin():
    return repository.list_secrets()


@_router.post("/admin/secrets", status_code=status.HTTP_201_CREATED,
              summary="Guarda ou actualiza uma chave secreta encriptada [super admin]",
              dependencies=[Depends(_require_super_admin)])
def salvar_secret(body: SecretIn):
    encrypted = _encrypt(body.value)
    repository.upsert_secret(body.key_name, encrypted)
    return {"key_name": body.key_name, "status": "saved"}


@_router.get("/admin/secrets/{key_name}/reveal",
             summary="Desencripta e devolve o valor de uma chave secreta [super admin]",
             dependencies=[Depends(_require_super_admin)])
def revelar_secret(key_name: str):
    encrypted = repository.get_secret_encrypted(key_name)
    if not encrypted:
        raise HTTPException(status_code=404, detail=f"Chave '{key_name}' não encontrada.")
    return {"key_name": key_name, "value": _decrypt(encrypted)}


@_router.delete("/admin/secrets/{key_name}", status_code=status.HTTP_204_NO_CONTENT,
                summary="Remove uma chave secreta [super admin]",
                dependencies=[Depends(_require_super_admin)])
def deletar_secret(key_name: str):
    deleted = repository.delete_secret(key_name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Chave '{key_name}' não encontrada.")


@_router.get("/plan", summary="Retorna o plano e limite de campos do tenant")
def obter_plano(tenant_id: str = Depends(_get_tenant_id)):
    plan = repository.get_tenant_plan(tenant_id)
    limit = repository.get_plan_field_limit(plan)
    count = repository.count_field_schemas(tenant_id)
    return {"plan": plan, "field_limit": limit, "field_count": count}


@_router.post("/schema/fields", status_code=status.HTTP_201_CREATED,
              summary="Adiciona ou actualiza um campo no schema do tenant")
def salvar_campo(body: FieldSchemaIn, tenant_id: str = Depends(_get_tenant_id)):
    if body.field_key == "name":
        raise HTTPException(status_code=400, detail="O campo 'name' é reservado e não pode ser configurado.")
    # Only new fields count against the plan limit — updates are always allowed
    current_schema = repository.get_tenant_schema(tenant_id)
    existing_keys = {f["field_key"] for f in current_schema}
    if body.field_key not in existing_keys:
        plan = repository.get_tenant_plan(tenant_id)
        limit = repository.get_plan_field_limit(plan)
        count = repository.count_field_schemas(tenant_id)
        if count >= limit:
            raise HTTPException(
                status_code=403,
                detail=f"Limite do plano {plan.capitalize()} atingido ({count}/{limit} campos). Faça upgrade para adicionar mais campos.",
            )
    repository.upsert_field_schema(tenant_id, {
        "field_key":        body.field_key,
        "label":            body.label,
        "field_type":       body.field_type,
        "required":         body.required,
        "position":         body.position,
        "validation_rules": body.validation_rules or {},
        "is_sensitive":     body.is_sensitive,
    })
    return repository.get_tenant_schema(tenant_id)


@_router.get("/plans", summary="Retorna configuração pública de planos (preços e limites)")
def listar_planos_publico(tenant_id: str = Depends(_get_tenant_id)):
    return repository.get_plan_configs()


@_router.get("/subscription", summary="Retorna status de subscrição do tenant autenticado")
def obter_subscricao(tenant_id: str = Depends(_get_tenant_id)):
    repository.ensure_trial_and_upsert(tenant_id)
    return repository.get_tenant_subscription(tenant_id)


@_router.post("/subscription/checkout", summary="Cria sessão Stripe Checkout para assinar um plano")
def criar_checkout(body: CheckoutIn, tenant_id: str = Depends(_get_tenant_id)):
    import stripe as _stripe
    stripe_key = _get_stripe_key()
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Stripe não configurado no servidor.")
    _stripe.api_key = stripe_key

    # Enterprise: cada tenant precisa de config customizada; 403 se não configurado
    if body.plan_name == "enterprise":
        custom = repository.get_enterprise_config(tenant_id)
        if not custom:
            raise HTTPException(
                status_code=403,
                detail="Plano Enterprise requer alinhamento comercial. Entre em contacto com a equipa de vendas.",
            )
        price_id = custom["stripe_price_id"]
    else:
        configs = repository.get_plan_configs()
        plan_cfg = next((c for c in configs if c["plan_name"] == body.plan_name), None)
        if not plan_cfg or not plan_cfg.get("stripe_price_id"):
            raise HTTPException(status_code=400, detail=f"Price ID para o plano '{body.plan_name}' não configurado.")
        price_id = plan_cfg["stripe_price_id"]

    sub_info = repository.get_tenant_subscription(tenant_id)
    customer_id = sub_info.get("stripe_customer_id")
    frontend_url = os.environ.get("FRONTEND_URL", "https://trust-tandem-ai.vercel.app")

    try:
        kwargs: dict = {
            "mode": "subscription",
            "line_items": [{"price": price_id, "quantity": 1}],
            "metadata": {"tenant_id": tenant_id, "plan_name": body.plan_name},
            "success_url": f"{frontend_url}/dashboard?sub=success",
            "cancel_url": f"{frontend_url}/dashboard?sub=canceled",
        }
        if customer_id:
            kwargs["customer"] = customer_id
        session = _stripe.checkout.Session.create(**kwargs)
        return {"checkout_url": session.url}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erro ao criar checkout: {e}")


@_router.post("/subscription/portal", summary="Cria sessão do portal Stripe para gerir subscrição")
def criar_portal(tenant_id: str = Depends(_get_tenant_id)):
    import stripe as _stripe
    stripe_key = _get_stripe_key()
    if not stripe_key:
        raise HTTPException(status_code=503, detail="Stripe não configurado no servidor.")
    _stripe.api_key = stripe_key

    sub_info = repository.get_tenant_subscription(tenant_id)
    customer_id = sub_info.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="Sem subscrição ativa para gerir.")

    frontend_url = os.environ.get("FRONTEND_URL", "https://trust-tandem-ai.vercel.app")
    try:
        session = _stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{frontend_url}/dashboard",
        )
        return {"portal_url": session.url}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erro ao criar portal: {e}")


@_router.post("/admin/stripe/sync", summary="Sincroniza preços dos planos com o Stripe [super admin]",
              dependencies=[Depends(_require_super_admin)])
def sincronizar_stripe():
    stripe_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not stripe_key:
        encrypted = repository.get_secret_encrypted("STRIPE_SECRET_KEY")
        if encrypted:
            stripe_key = _decrypt(encrypted)
    if not stripe_key:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY não configurada no servidor ou no cofre.")
    try:
        updated = repository.sync_stripe_plans(stripe_key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erro ao sincronizar com Stripe: {type(e).__name__}: {e}")
    return {"synced": len(updated), "plans": updated}


@_router.get("/admin/tenants",
             summary="Lista todos os tenants registados [super admin]",
             dependencies=[Depends(_require_super_admin)])
def listar_tenants():
    return repository.list_tenants()


@_router.get("/admin/enterprise/clients",
             summary="Lista configs de clientes Enterprise [super admin]",
             dependencies=[Depends(_require_super_admin)])
def listar_enterprise_clients():
    return repository.list_enterprise_configs()


@_router.post("/admin/enterprise/clients", status_code=status.HTTP_201_CREATED,
              summary="Cria ou actualiza config Enterprise de um cliente [super admin]",
              dependencies=[Depends(_require_super_admin)])
def upsert_enterprise_client(body: EnterpriseClientIn):
    return repository.upsert_enterprise_config(
        body.tenant_id, body.stripe_price_id, body.amount_display, body.currency_display
    )


@_router.delete("/admin/enterprise/clients/{client_tenant_id}",
                status_code=status.HTTP_204_NO_CONTENT,
                summary="Remove config Enterprise de um cliente [super admin]",
                dependencies=[Depends(_require_super_admin)])
def deletar_enterprise_client(client_tenant_id: str):
    deleted = repository.delete_enterprise_config(client_tenant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Config Enterprise para '{client_tenant_id}' não encontrada.")


@_router.delete("/schema/fields/{field_key}", status_code=status.HTTP_204_NO_CONTENT,
                summary="Remove um campo do schema do tenant")
def remover_campo(field_key: str, tenant_id: str = Depends(_get_tenant_id)):
    deleted = repository.delete_field_schema(tenant_id, field_key)
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Campo '{field_key}' não encontrado.")


@_router.delete("/reset", status_code=status.HTTP_204_NO_CONTENT,
                summary="Limpa o estado da sessão (útil para testes)")
def resetar_estado(painel: PainelOrquestracao = Depends(_get_painel)):
    painel.limpar_tudo()


@app.post("/stripe/webhook", include_in_schema=False)
async def stripe_webhook(request: Request):
    import stripe as _stripe
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not webhook_secret:
        return JSONResponse({"status": "no_webhook_secret_configured"})

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = _stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
    except Exception:
        raise HTTPException(status_code=400, detail="Webhook signature inválida.")

    event_type = event.get("type", "")
    stripe_key = _get_stripe_key()
    if stripe_key:
        _stripe.api_key = stripe_key

    if event_type in ("price.updated", "price.created"):
        price_obj = event["data"]["object"]
        product_id = price_obj.get("product")
        if product_id and stripe_key:
            try:
                product = _stripe.Product.retrieve(product_id)
                plan_name = (product.metadata or {}).get("plan_name")
                if plan_name:
                    amount_brl = (price_obj.get("unit_amount") or 0) / 100.0
                    field_limit = repository.get_plan_field_limit(plan_name)
                    repository.upsert_plan_config(plan_name, field_limit, amount_brl, price_obj["id"])
            except Exception:
                pass

    elif event_type == "checkout.session.completed":
        session_obj = event["data"]["object"]
        meta = session_obj.get("metadata") or {}
        t_id = meta.get("tenant_id")
        plan_name = meta.get("plan_name")
        if t_id and plan_name:
            repository.update_tenant_subscription(
                t_id, plan_name, "active",
                stripe_customer_id=session_obj.get("customer"),
                stripe_subscription_id=session_obj.get("subscription"),
            )

    elif event_type in ("customer.subscription.updated", "customer.subscription.created"):
        sub_obj = event["data"]["object"]
        cust_id = sub_obj.get("customer")
        if cust_id:
            t_id = repository.get_tenant_by_stripe_customer(cust_id)
            if t_id:
                new_status = sub_obj.get("status", "active")
                items = (sub_obj.get("items") or {}).get("data") or []
                plan_name = None
                if items:
                    price_id = (items[0].get("price") or {}).get("id")
                    if price_id:
                        configs = repository.get_plan_configs()
                        cfg = next((c for c in configs if c.get("stripe_price_id") == price_id), None)
                        if cfg:
                            plan_name = cfg["plan_name"]
                if plan_name:
                    mapped = "active" if new_status == "active" else new_status
                    repository.update_tenant_subscription(
                        t_id, plan_name, mapped,
                        stripe_subscription_id=sub_obj.get("id"),
                    )

    elif event_type == "customer.subscription.deleted":
        sub_obj = event["data"]["object"]
        cust_id = sub_obj.get("customer")
        if cust_id:
            t_id = repository.get_tenant_by_stripe_customer(cust_id)
            if t_id:
                repository.update_tenant_subscription(t_id, "starter", "canceled")

    return JSONResponse({"received": True})


@app.get("/api/v1/plans/public", summary="Retorna planos disponíveis para a landing page (sem auth)")
def planos_publicos():
    configs = repository.get_plan_configs()
    configs_sorted = sorted(configs, key=lambda c: c.get("price_monthly") or 0)
    return JSONResponse([
        {"plan_name": c["plan_name"], "price_monthly": c.get("price_monthly") or 0}
        for c in configs_sorted
    ])


app.include_router(_router)
