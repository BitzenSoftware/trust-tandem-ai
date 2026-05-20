import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from masking import sanitize_clients

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

API_URL = os.environ.get("CLIENT_API_URL", "")
API_KEY = os.environ.get("CLIENT_API_KEY", "")
OUTPUT_DIR = Path(__file__).parent.parent / "output"

RETRY_CONFIG = Retry(
    total=3,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
)


def _build_session() -> requests.Session:
    session = requests.Session()
    adapter = HTTPAdapter(max_retries=RETRY_CONFIG)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def fetch_clients(session: requests.Session) -> list[dict]:
    if not API_URL or not API_KEY:
        raise EnvironmentError("CLIENT_API_URL e CLIENT_API_KEY precisam estar definidos.")
    headers = {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"}
    logger.info("Buscando clientes em %s", API_URL)
    response = session.get(f"{API_URL}/clients", headers=headers, timeout=15)
    response.raise_for_status()
    data = response.json()
    # aceita tanto {"clients": [...]} quanto lista direta
    return data if isinstance(data, list) else data.get("clients", data.get("data", []))


def save_output(clients: list[dict]) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = OUTPUT_DIR / f"clients_safe_{timestamp}.json"
    out_path.write_text(json.dumps(clients, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def run() -> int:
    session = _build_session()
    try:
        raw_clients = fetch_clients(session)
    except EnvironmentError as exc:
        logger.error(exc)
        return 1
    except requests.HTTPError as exc:
        logger.error("Erro HTTP ao buscar clientes: %s", exc)
        return 1
    except requests.RequestException as exc:
        logger.error("Falha de conexão: %s", exc)
        return 1

    logger.info("%d clientes recebidos — iniciando mascaramento", len(raw_clients))
    safe_clients = sanitize_clients(raw_clients)

    out_path = save_output(safe_clients)
    logger.info("Dados seguros salvos em: %s", out_path)

    invalid_count = sum(
        1 for c in safe_clients
        if "invalid_data***" in (c.get("cpf", ""), c.get("email", ""))
    )
    if invalid_count:
        logger.warning("%d registro(s) com campos inválidos substituídos por fallback", invalid_count)

    return 0


if __name__ == "__main__":
    sys.exit(run())
