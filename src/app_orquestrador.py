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


def _validate_by_type(value: str | None, field_type: str, rules: dict | None = None) -> bool:
    """Returns True when value passes validation for the given field_type."""
    if value is None or not isinstance(value, str):
        return False
    v = value.strip()
    if not v:
        return False
    rules = rules or {}

    if field_type == "email":
        parts = v.split("@")
        return len(parts) == 2 and len(parts[0]) >= 2 and "." in parts[1]

    if field_type == "cpf":
        return len(re.sub(r"\D", "", v)) == 11

    if field_type == "document":
        digits = len(re.sub(r"\D", "", v))
        return digits in (11, 14)

    if field_type == "number":
        try:
            num = float(v.replace(",", "."))
            if "min" in rules and num < rules["min"]:
                return False
            if "max" in rules and num > rules["max"]:
                return False
            return True
        except ValueError:
            return False

    if field_type == "phone":
        return len(re.sub(r"\D", "", v)) in (10, 11)

    if field_type == "cep":
        return len(re.sub(r"\D", "", v)) == 8

    if field_type == "date":
        return bool(re.match(r"\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4}", v))

    # text / unknown
    return len(v) >= int(rules.get("min_length", 2))


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

    def processar_registro(self, cliente: dict, schema: list[dict] | None = None) -> None:
        if schema is None:
            schema = repository.get_tenant_schema(self.tenant_id)

        # name is always required
        if not cliente.get("name") or not str(cliente["name"]).strip():
            repository.save_to_queue(cliente, self.tenant_id)
            logger.warning("Registro sem nome válido enviado para Fila de Revisão Humana.")
            return

        # Validate all required schema fields
        all_valid = all(
            _validate_by_type(
                cliente.get(f["field_key"]),
                f["field_type"],
                f.get("validation_rules") or {},
            )
            for f in schema
            if f.get("required", True)
        )

        if all_valid:
            self.resolver_direto(cliente)
        else:
            repository.save_to_queue(cliente, self.tenant_id)
            logger.warning("Registro de '%s' enviado para Fila de Revisão Humana.", cliente["name"])

    def processar_lote(self, clientes: list[dict], schema: list[dict] | None = None) -> tuple[int, int]:
        """Classify all records first, then bulk-insert — reduces N HTTP calls to 2."""
        if schema is None:
            schema = repository.get_tenant_schema(self.tenant_id)

        valid_records: list[dict] = []
        invalid_records: list[dict] = []

        for cliente in clientes:
            if not cliente.get("name") or not str(cliente["name"]).strip():
                invalid_records.append(cliente)
                logger.warning("Registro sem nome válido enviado para Fila de Revisão Humana.")
                continue

            all_valid = all(
                _validate_by_type(
                    cliente.get(f["field_key"]),
                    f["field_type"],
                    f.get("validation_rules") or {},
                )
                for f in schema
                if f.get("required", True)
            )

            if all_valid:
                valid_records.append({
                    "name": cliente["name"],
                    "email": cliente.get("email") or "",
                    "cpf": cliente.get("cpf") or "",
                    **{k: v for k, v in cliente.items() if k not in ("name", "email", "cpf")},
                })
            else:
                invalid_records.append(cliente)
                logger.warning("Registro de '%s' enviado para Fila de Revisão Humana.", cliente["name"])

        repository.save_bulk(valid_records, self.tenant_id)
        repository.save_to_queue_bulk(invalid_records, self.tenant_id)

        return len(valid_records), len(invalid_records)

    def remover_da_fila(self, name: str) -> int:
        return repository.remove_from_queue(name, self.tenant_id)

    def resolver_direto(self, merged: dict) -> None:
        """Saves real (unmasked) data to clean_records — masking applied at display time."""
        repository.save({
            "name":  merged["name"],
            "email": merged.get("email") or "",
            "cpf":   merged.get("cpf") or "",
            **{k: v for k, v in merged.items() if k not in ("name", "email", "cpf")},
        }, self.tenant_id)

    def limpar_tudo(self) -> None:
        repository.clear(self.tenant_id)
        repository.clear_queue(self.tenant_id)
