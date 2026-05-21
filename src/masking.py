import logging
import re

logger = logging.getLogger(__name__)

_CPF_PATTERN = re.compile(r"(\d{3})\.(\d{3})\.(\d{3})-(\d{2})")
_SAFE_FALLBACK = "invalid_data***"


def _normalize_cpf(cpf: str) -> str:
    """Formats 11-digit string into XXX.XXX.XXX-XX before masking."""
    digits = re.sub(r"\D", "", cpf)
    if len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return cpf


def mask_cpf(cpf: str | None) -> str:
    if not cpf or not isinstance(cpf, str):
        return _SAFE_FALLBACK
    cpf = _normalize_cpf(cpf.strip())
    match = _CPF_PATTERN.fullmatch(cpf)
    if not match:
        logger.warning("mask_cpf: formato inválido recebido — dado omitido")
        return _SAFE_FALLBACK
    return f"***.***.***-{match.group(4)}"


def mask_email(email: str | None) -> str:
    if not email or not isinstance(email, str):
        return _SAFE_FALLBACK
    email = email.strip()
    if "@" not in email:
        logger.warning("mask_email: sem '@' — dado omitido")
        return _SAFE_FALLBACK
    local, domain = email.split("@", 1)
    if not local or not domain or "." not in domain:
        logger.warning("mask_email: estrutura inválida — dado omitido")
        return _SAFE_FALLBACK
    domain_name, tld = domain.rsplit(".", 1)
    if len(local) < 2 or len(domain_name) < 2:
        logger.warning("mask_email: partes muito curtas — dado omitido")
        return _SAFE_FALLBACK
    return f"{local[0]}***@{domain_name[0]}***.{tld}"


def sanitize_clients(clients: list[dict]) -> list[dict]:
    return [
        {**c, "cpf": mask_cpf(c.get("cpf")), "email": mask_email(c.get("email"))}
        for c in clients
    ]
