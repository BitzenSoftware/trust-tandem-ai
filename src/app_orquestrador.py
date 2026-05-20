import logging
import re

import repository
from masking import mask_cpf, mask_email

logging.basicConfig(
    level=logging.INFO,
    format="\033[94m[PAINEL IA]\033[0m %(message)s",
)
logger = logging.getLogger(__name__)

SEP = "=" * 60


def _is_valid_email(value) -> bool:
    if not value or not isinstance(value, str):
        return False
    v = value.strip()
    return bool(v) and "@" in v and len(v.split("@")[0]) >= 2


def _is_valid_cpf(value) -> bool:
    if not value or not isinstance(value, str):
        return False
    return len(re.sub(r"\D", "", value)) == 11


def _hint(value: str, chars: int = 3) -> str:
    """Exibe apenas os primeiros caracteres para identificação mínima sem expor dado completo."""
    if not value or value.lower() == "none":
        return "[vazio]"
    return value[:chars] + "…"


class PainelOrquestracao:
    def __init__(self):
        repository.init_db()
        self.fila_revisao: list[dict] = []

    @property
    def banco_limpo(self) -> list[dict]:
        return repository.all_records()

    def processar_registro(self, cliente: dict) -> None:
        email = cliente.get("email")
        cpf = cliente.get("cpf")

        if _is_valid_email(email) and _is_valid_cpf(cpf):
            repository.save({
                "name": cliente["name"],
                "email": mask_email(email),
                "cpf": mask_cpf(cpf),
            })
        else:
            self.fila_revisao.append(cliente)
            logger.warning("Registro de '%s' enviado para Fila de Revisão Humana.", cliente["name"])

    def iniciar_interfacao_humana(self) -> None:
        if not self.fila_revisao:
            print("\nNenhuma anomalia detectada. Todos os dados foram processados com segurança.")
            return

        print(f"\n{SEP}")
        print("  PAINEL DE INTERVENCAO HUMANO-IA")
        print(SEP)
        print(f"  {len(self.fila_revisao)} registro(s) aguardam sua decisao.\n")

        for idx, item in enumerate(list(self.fila_revisao)):
            print(f"--- [ALERTA #{idx + 1}] ---")
            print(f"  Nome    : {item['name']}")
            # exibe apenas dica parcial — nunca o dado bruto completo
            print(f"  E-mail  : {_hint(str(item.get('email', '')))} (dado original omitido por segurança)")
            print(f"  CPF     : {_hint(str(item.get('cpf', '')))} (dado original omitido por segurança)")
            print("-" * 40)
            print("  Opcoes:")
            print("  [1] Descartar registro (compliance)")
            print("  [2] Corrigir dados manualmente")
            print("  [3] Salvar com mascara generica de erro")

            opcao = input("  Escolha (1/2/3): ").strip()

            if opcao == "1":
                print(f"  Registro de '{item['name']}' descartado.\n")

            elif opcao == "2":
                novo_email = input("  Novo e-mail: ").strip()
                novo_cpf = input("  Novo CPF: ").strip()
                self.processar_registro({
                    "name": item["name"],
                    "email": novo_email,
                    "cpf": novo_cpf,
                })
                print(f"  Registro de '{item['name']}' re-enviado ao pipeline.\n")

            else:
                repository.save({
                    "name": item["name"],
                    "email": "invalid_data***",
                    "cpf": "invalid_data***",
                })
                print(f"  Registro de '{item['name']}' salvo com mascara generica.\n")

        self.fila_revisao.clear()


if __name__ == "__main__":
    painel = PainelOrquestracao()

    dados_api = [
        {"name": "Ana Costa",   "email": "ana.costa@gmail.com", "cpf": "123.456.789-00"},
        {"name": "João Errado", "email": "joao.silva.com",      "cpf": "123.ABC.789-XX"},
        {"name": "Maria Nula",  "email": None,                  "cpf": ""},
    ]

    print("IA iniciando varredura de dados...")
    for cliente in dados_api:
        painel.processar_registro(cliente)

    painel.iniciar_interfacao_humana()

    print(f"\n{SEP}")
    print("  RELATORIO FINAL — BANCO DE DADOS SEGURO")
    print(SEP)
    for c in painel.banco_limpo:
        print(f"  {c['name']:<20} | {c['email']:<30} | {c['cpf']}")
