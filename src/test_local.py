import logging
import sqlite3
from pathlib import Path

from masking import sanitize_clients

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent / "output" / "customers_test.db"

MOCK_DATA = [
    {"name": "Ana Costa",    "email": "ana.costa@gmail.com", "cpf": "123.456.789-00"},
    {"name": "Zé Silva",     "email": "z@x.com",             "cpf": "98765432100"},
    {"name": "João Errado",  "email": "joao.silva.com",      "cpf": "123.ABC.789-XX"},
    {"name": "Maria Nula",   "email": None,                  "cpf": ""},
    {"name": "Admin",        "email": "   ",                 "cpf": None},
]


def init_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT,
            email TEXT,
            cpf   TEXT
        )
    """)
    conn.commit()
    return conn


def run_stress_test() -> None:
    logger.info("Iniciando teste de estresse com %d registros mockados", len(MOCK_DATA))

    safe_data = sanitize_clients(MOCK_DATA)

    conn = init_db(DB_PATH)
    conn.executemany(
        "INSERT INTO customers (name, email, cpf) VALUES (:name, :email, :cpf)",
        safe_data,
    )
    conn.commit()

    logger.info("--- RESULTADO NO BANCO (MÁSCARA LGPD) ---")
    rows = conn.execute("SELECT id, name, email, cpf FROM customers").fetchall()
    for row in rows:
        print(f"ID: {row[0]} | Nome: {row[1]:<15} | E-mail: {row[2]:<25} | CPF: {row[3]}")

    invalid_count = sum(
        1 for r in safe_data
        if "invalid_data***" in (r.get("email", ""), r.get("cpf", ""))
    )
    logger.info("Registros com fallback de proteção: %d/%d", invalid_count, len(safe_data))
    conn.close()
    logger.info("Teste concluído. Banco salvo em: %s", DB_PATH)


if __name__ == "__main__":
    run_stress_test()
