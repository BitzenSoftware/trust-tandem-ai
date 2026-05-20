import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import anthropic
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field

import repository
from app_orquestrador import PainelOrquestracao, _hint

AGENTS_DIR = Path(__file__).parent.parent / "agents"
_API_KEY = os.environ.get("API_GATEWAY_KEY", "")
_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)

_startup_logger = __import__("logging").getLogger("uvicorn.error")
if not _API_KEY:
    _startup_logger.warning(
        "SEGURANÇA: API_GATEWAY_KEY não configurada — modo dev ativo, "
        "todos os requests são permitidos sem autenticação."
    )
else:
    _startup_logger.info("API_GATEWAY_KEY configurada — autenticação X-API-Key ativa.")


def _auth(key: str | None = Security(_key_scheme)) -> None:
    """Sem API_GATEWAY_KEY configurada, permite tudo (modo dev/teste)."""
    if _API_KEY and key != _API_KEY:
        raise HTTPException(status_code=401, detail="X-API-Key inválida ou ausente.")
_claude = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-6"


def _load_prompt(name: str) -> str:
    return (AGENTS_DIR / f"{name}.txt").read_text(encoding="utf-8")


def _call_claude(system: str, message: str) -> str:
    resp = _claude.messages.create(
        model=MODEL,
        max_tokens=512,
        system=system,
        messages=[{"role": "user", "content": message}],
    )
    return resp.content[0].text

_docs_url = None if _API_KEY else "/docs"
_redoc_url = None if _API_KEY else "/redoc"

app = FastAPI(
    title="Trust & Tandem AI Gateway",
    description="API segura de ingestão de dados em conformidade com LGPD — Orquestração Humano-IA",
    version="1.0.0",
    docs_url=_docs_url,
    redoc_url=_redoc_url,
)

# Public route — no auth, used by Railway/Docker healthchecks
@app.get("/health", include_in_schema=False)
def health():
    return {"status": "ok"}

# All business routes require X-API-Key
_router = APIRouter(prefix="/api/v1", dependencies=[Depends(_auth)])


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
    """Expõe apenas dicas parciais — nunca o dado bruto completo."""
    name: str
    email_hint: str
    cpf_hint: str


class DiagnosticoOut(BaseModel):
    name: str
    diagnostico: str


# --- ESTADO (escopo da sessão — substituir por DB em produção) ---
# Singleton intencional para demo local. Em produção: usar repositório por sessão/tenant.
_orquestrador = PainelOrquestracao()


# --- ROTAS ---

@_router.post(
    "/ingest",
    response_model=RespostaIngestao,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ingere lote de clientes e separa anomalias para revisão humana",
)
def ingerir_dados(clientes: list[ClienteInput]):
    if not clientes:
        raise HTTPException(status_code=400, detail="A lista de clientes não pode estar vazia.")

    for cliente in clientes:
        _orquestrador.processar_registro(cliente.model_dump())

    return RespostaIngestao(
        status="Processado",
        mensagem="Lote avaliado pela IA de Compliance.",
        registros_banco_limpo=len(_orquestrador.banco_limpo),
        registros_fila_revisao=len(_orquestrador.fila_revisao),
    )


@_router.get(
    "/review-queue",
    response_model=list[RegistroRevisaoOut],
    summary="Lista registros aguardando intervenção humana (dados parciais por LGPD)",
)
def listar_fila_revisao():
    return [
        RegistroRevisaoOut(
            name=item["name"],
            email_hint=_hint(str(item.get("email", ""))),
            cpf_hint=_hint(str(item.get("cpf", ""))),
        )
        for item in _orquestrador.fila_revisao
    ]


@_router.get(
    "/database",
    response_model=list[RegistroMascaradoOut],
    summary="Retorna dados já mascarados e aprovados para persistência",
)
def visualizar_banco_seguro():
    return _orquestrador.banco_limpo


@_router.post(
    "/resolve",
    response_model=RespostaIngestao,
    summary="Submete correção humana para um registro da fila de revisão",
)
def resolver_registro(cliente: ClienteInput):
    _orquestrador.fila_revisao[:] = [
        r for r in _orquestrador.fila_revisao if r["name"] != cliente.name
    ]
    _orquestrador.processar_registro(cliente.model_dump())
    return RespostaIngestao(
        status="Resolvido",
        mensagem=f"Registro '{cliente.name}' reprocessado com dados corrigidos.",
        registros_banco_limpo=len(_orquestrador.banco_limpo),
        registros_fila_revisao=len(_orquestrador.fila_revisao),
    )


@_router.get(
    "/analyze/{name}",
    response_model=DiagnosticoOut,
    summary="Solicita diagnóstico Claude para um registro da fila (via hints — sem dado bruto)",
)
def analisar_registro(name: str):
    record = next((r for r in _orquestrador.fila_revisao if r["name"] == name), None)
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


@_router.delete(
    "/review-queue/{name}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Expurga um registro específico da fila de revisão (direito ao esquecimento LGPD)",
)
def expurgar_registro(name: str):
    antes = len(_orquestrador.fila_revisao)
    _orquestrador.fila_revisao[:] = [
        r for r in _orquestrador.fila_revisao if r["name"] != name
    ]
    if len(_orquestrador.fila_revisao) == antes:
        raise HTTPException(status_code=404, detail=f"Registro '{name}' não encontrado na fila.")


@_router.delete(
    "/reset",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Limpa o estado da sessão (útil para testes repetidos)",
)
def resetar_estado():
    _orquestrador.fila_revisao.clear()
    repository.clear()


app.include_router(_router)
