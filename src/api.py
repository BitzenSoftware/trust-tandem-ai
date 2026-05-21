import json
import os
import re
import sys
from pathlib import Path

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
    return {"status": "ok"}


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


# --- ROTAS ---

@_router.post("/ingest", response_model=RespostaIngestao, status_code=status.HTTP_202_ACCEPTED,
              summary="Ingere lote de clientes e separa anomalias para revisão humana")
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
def resolver_registro(cliente: ClienteInput, painel: PainelOrquestracao = Depends(_get_painel)):
    before = len(painel.banco_limpo)
    painel.remover_da_fila(cliente.name)
    painel.processar_registro(cliente.model_dump())
    after_records = painel.banco_limpo
    if len(after_records) > before:
        wh = repository.get_webhook(painel.tenant_id)
        if wh and wh.get("active"):
            repository.fire_webhook(wh["url"], wh["secret"], after_records[-1:])
    return RespostaIngestao(
        status="Resolvido",
        mensagem=f"Registro '{cliente.name}' reprocessado com dados corrigidos.",
        registros_banco_limpo=len(after_records),
        registros_fila_revisao=len(painel.fila_revisao),
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


@_router.get("/analyze/{name}", summary="Diagnóstico estruturado Claude para um registro da fila")
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
def expurgar_registro(name: str, painel: PainelOrquestracao = Depends(_get_painel)):
    deleted = painel.remover_da_fila(name)
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"Registro '{name}' não encontrado na fila.")


@_router.delete("/reset", status_code=status.HTTP_204_NO_CONTENT,
                summary="Limpa o estado da sessão (útil para testes)")
def resetar_estado(painel: PainelOrquestracao = Depends(_get_painel)):
    painel.limpar_tudo()


app.include_router(_router)
