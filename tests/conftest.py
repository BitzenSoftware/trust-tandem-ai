import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from api import app  # noqa: E402 — sys.path setup must come first


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.delete("/api/v1/reset")
        yield c
        c.delete("/api/v1/reset")
