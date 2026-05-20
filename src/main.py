import os
import anthropic
import requests
from pathlib import Path

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-6"
AGENTS_DIR = Path(__file__).parent.parent / "agents"
MAX_AUDIT_RETRIES = 2
API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000")

SEP = "=" * 60


# ---------------------------------------------------------------------------
# Infraestrutura de agentes
# ---------------------------------------------------------------------------

def load_prompt(agent_name: str) -> str:
    path = AGENTS_DIR / f"{agent_name}.txt"
    return path.read_text(encoding="utf-8")


def call_agent(system_prompt: str, user_message: str) -> str:
    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text


# ---------------------------------------------------------------------------
# Pipeline geral (Supervisor → Executor → Auditor)
# ---------------------------------------------------------------------------

def run_pipeline(user_input: str) -> str:
    supervisor_prompt = load_prompt("supervisor")
    executor_prompt = load_prompt("executor")
    auditor_prompt = load_prompt("auditor")

    print("\n[SUPERVISOR] Analisando demanda do usuário...")
    supervisor_plan = call_agent(supervisor_prompt, f"Demanda do usuário: {user_input}")
    print(f"\n{supervisor_plan}")

    executor_task = f"Plano do Supervisor:\n{supervisor_plan}\n\nDemanda original: {user_input}"

    for attempt in range(1, MAX_AUDIT_RETRIES + 2):
        print(f"\n[EXECUTOR] Executando tarefa (tentativa {attempt})...")
        executor_output = call_agent(executor_prompt, executor_task)
        print(f"\n{executor_output}")

        print("\n[AUDITOR] Auditando resultado...")
        audit_result = call_agent(
            auditor_prompt,
            f"Output do Executor:\n\n{executor_output}\n\nContexto: {user_input}",
        )
        print(f"\n{audit_result}")

        if audit_result.strip().upper().startswith("APROVADO"):
            print("\n[SUPERVISOR] Consolidando resposta final...")
            return call_agent(
                supervisor_prompt,
                (
                    f"Executor produziu:\n\n{executor_output}\n\n"
                    f"Auditor aprovou:\n\n{audit_result}\n\n"
                    "Consolide e formate a resposta final para o usuário."
                ),
            )

        if attempt <= MAX_AUDIT_RETRIES:
            print(f"\n[SUPERVISOR] Auditor rejeitou. Corrigindo (tentativa {attempt + 1})...")
            executor_task = (
                f"Sua tentativa anterior foi REJEITADA pelo Auditor.\n\n"
                f"Relatório:\n{audit_result}\n\n"
                f"Tarefa original:\n{user_input}\n\n"
                "Corrija os problemas apontados e entregue nova solução."
            )

    return (
        f"Pipeline não produziu solução aprovada após {MAX_AUDIT_RETRIES + 1} tentativas.\n"
        f"Último relatório do Auditor:\n\n{audit_result}"
    )


# ---------------------------------------------------------------------------
# Workflow de revisão da fila com assistência do Claude
# ---------------------------------------------------------------------------

def _fetch_queue() -> list[dict]:
    resp = requests.get(f"{API_BASE}/api/v1/review-queue", timeout=10)
    resp.raise_for_status()
    return resp.json()


def _submit_resolution(name: str, email: str, cpf: str) -> dict:
    resp = requests.post(
        f"{API_BASE}/api/v1/resolve",
        json={"name": name, "email": email, "cpf": cpf},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def _analyze_with_claude(record: dict) -> str:
    return call_agent(
        load_prompt("supervisor"),
        (
            f"Um registro de cliente está na fila de revisão por dados inválidos.\n\n"
            f"Nome: {record['name']}\n"
            f"Email (hint parcial): {record['email_hint']}\n"
            f"CPF (hint parcial): {record['cpf_hint']}\n\n"
            "Com base nos hints, explique de forma concisa:\n"
            "1. O que provavelmente está errado em cada campo\n"
            "2. Qual informação precisa ser solicitada ao operador humano\n"
            "3. Qual formato correto esperado\n\n"
            "Seja direto e técnico. Não faça perguntas — apenas analise e oriente."
        ),
    )


def _validate_correction(name: str, email: str, cpf: str) -> str:
    return call_agent(
        load_prompt("auditor"),
        (
            f"Valide a correção proposta pelo operador humano:\n\n"
            f"Nome: {name}\n"
            f"Email corrigido: {email}\n"
            f"CPF corrigido: {cpf}\n\n"
            "Verifique:\n"
            "1. Email tem formato válido (contém @, domínio com ponto)\n"
            "2. CPF tem 11 dígitos numéricos (formatado ou não)\n"
            "3. Campos não contêm strings maliciosas (SQL injection, scripts)\n\n"
            "Responda APROVADO ou REJEITADO com justificativa breve."
        ),
    )


def run_review_workflow() -> None:
    print(f"\n{SEP}")
    print("  MODO: REVISÃO DE FILA COM ASSISTÊNCIA CLAUDE")
    print(SEP)

    try:
        queue = _fetch_queue()
    except requests.ConnectionError:
        print("\nERRO: API offline. Execute primeiro: uvicorn src.api:app --reload")
        return

    if not queue:
        print("\nFila de revisão vazia. Nenhuma ação necessária.")
        return

    print(f"\n{len(queue)} registro(s) aguardando revisão.\n")

    for idx, record in enumerate(queue):
        print(f"{SEP}")
        print(f"  ALERTA #{idx + 1} — {record['name']}")
        print(SEP)
        print(f"  email_hint : {record['email_hint']}")
        print(f"  cpf_hint   : {record['cpf_hint']}")

        print("\n[CLAUDE — SUPERVISOR] Analisando o problema...")
        analysis = _analyze_with_claude(record)
        print(f"\n{analysis}\n")

        print("-" * 40)
        print("  [1] Corrigir dados agora")
        print("  [2] Descartar registro")
        print("  [3] Pular para o próximo")
        choice = input("  Escolha (1/2/3): ").strip()

        if choice == "2":
            print(f"\n  Registro '{record['name']}' descartado.\n")
            continue
        if choice == "3":
            print(f"\n  Registro '{record['name']}' ignorado nesta sessão.\n")
            continue

        email = input(f"\n  Email correto para '{record['name']}': ").strip()
        cpf = input(f"  CPF correto para '{record['name']}': ").strip()

        print("\n[CLAUDE — AUDITOR] Validando correção...")
        validation = _validate_correction(record["name"], email, cpf)
        print(f"\n{validation}\n")

        if "APROVADO" in validation.upper():
            result = _submit_resolution(record["name"], email, cpf)
            print(
                f"  Registro processado. "
                f"Banco limpo: {result['registros_banco_limpo']} | "
                f"Fila restante: {result['registros_fila_revisao']}\n"
            )
        else:
            print("  Correção rejeitada pelo Auditor. Registro mantido na fila.\n")

    print(f"{SEP}")
    print("  SESSÃO DE REVISÃO CONCLUÍDA")
    print(SEP)


# ---------------------------------------------------------------------------
# Entrypoint com menu de modo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"\n{SEP}")
    print("  TRUST & TANDEM — Multi-Agent Pipeline")
    print(SEP)
    print("  [1] Pipeline geral (Supervisor → Executor → Auditor)")
    print("  [2] Revisão de fila com assistência Claude")
    print(SEP)

    mode = input("  Modo (1/2): ").strip()

    if mode == "2":
        run_review_workflow()
    else:
        print("\nDigite 'sair' para encerrar.\n")
        while True:
            user_input = input("Você: ").strip()
            if user_input.lower() in ("sair", "exit", "quit"):
                break
            if not user_input:
                continue
            result = run_pipeline(user_input)
            print(f"\n{SEP}\nRESPOSTA FINAL:\n{SEP}\n{result}\n{SEP}\n")
