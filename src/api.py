import base64
import json
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

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
    return PainelOrquestracao(tenant_id=tenant_id)


class _TenantRateLimiter:
    """Sliding-window in-memory rate limiter per tenant_id."""

    def __init__(self, max_requests: int = 20, window_seconds: int = 60):
        self._max = max_requests
        self._window = window_seconds
        self._buckets: dict[str, deque] = defaultdict(deque)
        self._lock = Lock()

    def check(self, tenant_id: str) -> None:
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            dq = self._buckets[tenant_id]
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= self._max:
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit: máximo {self._max} requisições por {self._window}s por tenant.",
                    headers={"Retry-After": str(self._window)},
                )
            dq.append(now)


_rate_limiter = _TenantRateLimiter(max_requests=20, window_seconds=60)


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
    name: str = Field(..., examples=["João Errado"])
    email: Optional[str] = Field(None, examples=["joao.silva.com"])
    cpf: Optional[str] = Field(None, examples=["123.ABC.789-XX"])


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


# --- ROTAS ---

@_router.post("/ingest", response_model=RespostaIngestao, status_code=status.HTTP_202_ACCEPTED,
              summary="Ingere lote de clientes e separa anomalias para revisão humana",
              dependencies=[Depends(_rate_limit)])
def ingerir_dados(clientes: list[ClienteInput], painel: PainelOrquestracao = Depends(_get_painel)):
    if not clientes:
        raise HTTPException(status_code=400, detail="A lista de clientes não pode estar vazia.")
    for cliente in clientes:
        painel.processar_registro(cliente.model_dump())
    return RespostaIngestao(
        status="Processado",
        mensagem="Lote avaliado pela IA de Compliance.",
        registros_banco_limpo=len(painel.banco_limpo),
        registros_fila_revisao=len(painel.fila_revisao),
    )


@_router.get("/review-queue", response_model=list[RegistroRevisaoOut],
             summary="Lista registros aguardando intervenção humana")
def listar_fila_revisao(painel: PainelOrquestracao = Depends(_get_painel)):
    return [
        RegistroRevisaoOut(
            name=item["name"],
            email_hint=_hint(str(item.get("email", ""))),
            cpf_hint=_hint(str(item.get("cpf", ""))),
        )
        for item in painel.fila_revisao
    ]


@_router.get("/database", response_model=list[RegistroMascaradoOut],
             summary="Retorna dados mascarados aprovados para persistência")
def visualizar_banco_seguro(painel: PainelOrquestracao = Depends(_get_painel)):
    return painel.banco_limpo


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
    repository.create_audit_log(
        tenant_id=painel.tenant_id,
        operator_email=operator_email,
        record_name=cliente.name,
        action="APPROVE_MANUAL",
        fields_affected={"email_provided": cliente.email is not None, "cpf_provided": cliente.cpf is not None},
    )
    return RespostaIngestao(
        status="Resolvido",
        mensagem=f"Registro '{cliente.name}' reprocessado com dados corrigidos.",
        registros_banco_limpo=len(after_records),
        registros_fila_revisao=len(painel.fila_revisao),
    )


@_router.post("/bulk-resolve", response_model=BulkResolveReport,
              summary="Resolve em lote registros da fila — único round-trip HTTP, N operações DB",
              dependencies=[Depends(_rate_limit)])
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
        repository.create_audit_log(
            tenant_id=painel.tenant_id,
            operator_email=operator_email,
            record_name=item.name,
            action="APPROVE_BULK",
            fields_affected={"email_provided": item.email is not None, "cpf_provided": item.cpf is not None},
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


_DIAGNOSIS_SYSTEM = """Você é um especialista em validação de dados cadastrais brasileiros (CPF, CNPJ, e-mail).
Analise o registro abaixo e retorne EXCLUSIVAMENTE um objeto JSON válido, sem markdown, sem texto extra.

Schema obrigatório (todos os campos são strings):
{
  "campo_afetado": "email" | "cpf" | "email_e_cpf",
  "valor_original": "<valor exato com o erro>",
  "valor_sugerido": "<valor corrigido>",
  "diagnostico_motivo": "<explicação concisa do erro, máx. 2 linhas>"
}"""


@_router.get("/analyze/{name}", summary="Diagnóstico estruturado Claude para um registro da fila",
             dependencies=[Depends(_rate_limit)])
def analisar_registro(name: str, painel: PainelOrquestracao = Depends(_get_painel)):
    record = next((r for r in painel.fila_revisao if r["name"] == name), None)
    if not record:
        raise HTTPException(status_code=404, detail=f"Registro '{name}' não encontrado na fila.")

    user_msg = (
        f"Nome: {record['name']}\n"
        f"Email: {record.get('email', '')}\n"
        f"CPF: {record.get('cpf', '')}\n\n"
        "Identifique qual campo está inválido e retorne o JSON de diagnóstico."
    )
    raw = _call_claude(_DIAGNOSIS_SYSTEM, user_msg)

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


@_router.delete("/reset", status_code=status.HTTP_204_NO_CONTENT,
                summary="Limpa o estado da sessão (útil para testes)")
def resetar_estado(painel: PainelOrquestracao = Depends(_get_painel)):
    painel.limpar_tudo()


app.include_router(_router)
