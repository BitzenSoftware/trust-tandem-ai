import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import anthropic
import jwt as pyjwt
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

import repository
from app_orquestrador import PainelOrquestracao, _hint

AGENTS_DIR = Path(__file__).parent.parent / "agents"

_JWT_SECRET  = os.environ.get("SUPABASE_JWT_SECRET", "")
_API_KEY     = os.environ.get("API_GATEWAY_KEY", "")
_bearer      = HTTPBearer(auto_error=False)
_key_scheme  = APIKeyHeader(name="X-API-Key", auto_error=False)

_startup_logger = __import__("logging").getLogger("uvicorn.error")
if not _API_KEY:
    _startup_logger.warning(
        "SEGURANÇA: API_GATEWAY_KEY não configurada — modo dev ativo."
    )
else:
    _startup_logger.info("API_GATEWAY_KEY configurada — autenticação ativa.")


def _get_tenant_id(
    creds: HTTPAuthorizationCredentials | None = Security(_bearer),
    api_key: str | None = Security(_key_scheme),
) -> str:
    """Aceita Bearer JWT (Next.js) ou X-API-Key (Streamlit/legado)."""
    if creds:
        if not _JWT_SECRET:
            raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET não configurado.")
        try:
            payload = pyjwt.decode(
                creds.credentials, _JWT_SECRET,
                algorithms=["HS256"], audience="authenticated",
            )
            tenant_id = payload.get("user_metadata", {}).get("tenant_id")
            if not tenant_id:
                raise HTTPException(status_code=403, detail="Tenant não configurado para este utilizador.")
            return str(tenant_id)
        except pyjwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expirado.")
        except pyjwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Token inválido.")

    if _API_KEY and api_key == _API_KEY:
        return "default"

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
    diagnostico: str


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
    painel.remover_da_fila(cliente.name)
    painel.processar_registro(cliente.model_dump())
    return RespostaIngestao(
        status="Resolvido",
        mensagem=f"Registro '{cliente.name}' reprocessado com dados corrigidos.",
        registros_banco_limpo=len(painel.banco_limpo),
        registros_fila_revisao=len(painel.fila_revisao),
    )


@_router.get("/analyze/{name}", response_model=DiagnosticoOut,
             summary="Diagnóstico Claude para um registro da fila")
def analisar_registro(name: str, painel: PainelOrquestracao = Depends(_get_painel)):
    record = next((r for r in painel.fila_revisao if r["name"] == name), None)
    if not record:
        raise HTTPException(status_code=404, detail=f"Registro '{name}' não encontrado na fila.")
    diagnostico = _call_claude(
        _load_prompt("supervisor"),
        (
            f"Um registro está na fila de revisão por dados inválidos.\n\n"
            f"Nome: {record['name']}\n"
            f"Email (hint parcial): {_hint(str(record.get('email', '')))}\n"
            f"CPF (hint parcial): {_hint(str(record.get('cpf', '')))}\n\n"
            "Explique de forma concisa (máximo 3 linhas):\n"
            "1. O que provavelmente está errado em cada campo\n"
            "2. Qual formato correto é esperado\n"
            "Não faça perguntas. Apenas diagnostique."
        ),
    )
    return DiagnosticoOut(name=name, diagnostico=diagnostico)


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
