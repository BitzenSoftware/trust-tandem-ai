import logging
import re

import repository
from masking import mask_cpf, mask_email

logging.basicConfig(
    level=logging.INFO,
    format="\033[94m[PAINEL IA]\033[0m %(message)s",
)
logger = logging.getLogger(__name__)


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
    if not value or value.lower() == "none":
        return "[vazio]"
    return value[:chars] + "…"


class PainelOrquestracao:
    def __init__(self, tenant_id: str = "default"):
        self.tenant_id = tenant_id
        repository.init_db()

    @property
    def banco_limpo(self) -> list[dict]:
        return repository.all_records(self.tenant_id)

    @property
    def fila_revisao(self) -> list[dict]:
        return repository.get_queue(self.tenant_id)

    def processar_registro(self, cliente: dict) -> None:
        email = cliente.get("email")
        cpf = cliente.get("cpf")

        if _is_valid_email(email) and _is_valid_cpf(cpf):
            repository.save({
                "name": cliente["name"],
                "email": mask_email(email),
                "cpf": mask_cpf(cpf),
            }, self.tenant_id)
        else:
            repository.save_to_queue(cliente, self.tenant_id)
            logger.warning("Registro de '%s' enviado para Fila de Revisão Humana.", cliente["name"])

    def remover_da_fila(self, name: str) -> int:
        return repository.remove_from_queue(name, self.tenant_id)

    def limpar_tudo(self) -> None:
        repository.clear(self.tenant_id)
        repository.clear_queue(self.tenant_id)
