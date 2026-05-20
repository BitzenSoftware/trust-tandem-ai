import pytest

VALID   = {"name": "Ana Costa",   "email": "ana.costa@gmail.com", "cpf": "123.456.789-00"}
INVALID = {"name": "João Errado", "email": "joao.silva.com",      "cpf": "123.ABC.789-XX"}
NULL    = {"name": "Maria Nula",  "email": None,                  "cpf": ""}


class TestIngest:
    def test_valid_record_goes_to_clean_db(self, client):
        res = client.post("/api/v1/ingest", json=[VALID])
        assert res.status_code == 202
        data = res.json()
        assert data["registros_banco_limpo"] == 1
        assert data["registros_fila_revisao"] == 0

    def test_invalid_record_goes_to_queue(self, client):
        res = client.post("/api/v1/ingest", json=[INVALID])
        assert res.status_code == 202
        data = res.json()
        assert data["registros_banco_limpo"] == 0
        assert data["registros_fila_revisao"] == 1

    def test_mixed_batch(self, client):
        res = client.post("/api/v1/ingest", json=[VALID, INVALID, NULL])
        assert res.status_code == 202
        data = res.json()
        assert data["registros_banco_limpo"] == 1
        assert data["registros_fila_revisao"] == 2

    def test_empty_list_returns_400(self, client):
        res = client.post("/api/v1/ingest", json=[])
        assert res.status_code == 400


class TestReviewQueue:
    def test_returns_hints_not_raw_data(self, client):
        client.post("/api/v1/ingest", json=[INVALID])
        res = client.get("/api/v1/review-queue")
        assert res.status_code == 200
        item = res.json()[0]
        assert "email_hint" in item
        assert "cpf_hint" in item
        assert "email" not in item   # dado bruto nunca exposto
        assert "cpf" not in item

    def test_empty_queue_returns_empty_list(self, client):
        res = client.get("/api/v1/review-queue")
        assert res.json() == []


class TestDatabase:
    def test_masked_fields_in_clean_db(self, client):
        client.post("/api/v1/ingest", json=[VALID])
        res = client.get("/api/v1/database")
        assert res.status_code == 200
        record = res.json()[0]
        assert "***" in record["cpf"]
        assert "***" in record["email"]

    def test_raw_data_not_in_clean_db(self, client):
        client.post("/api/v1/ingest", json=[VALID])
        record = client.get("/api/v1/database").json()[0]
        assert "123.456.789-00" not in record["cpf"]
        assert "ana.costa@gmail.com" not in record["email"]


class TestResolve:
    def test_moves_record_from_queue_to_clean(self, client):
        client.post("/api/v1/ingest", json=[INVALID])
        res = client.post("/api/v1/resolve", json={
            "name": "João Errado",
            "email": "joao@empresa.com",
            "cpf": "123.456.789-00",
        })
        assert res.status_code == 200
        data = res.json()
        assert data["registros_fila_revisao"] == 0
        assert data["registros_banco_limpo"] == 1

    def test_corrected_data_is_masked_in_clean_db(self, client):
        client.post("/api/v1/ingest", json=[INVALID])
        client.post("/api/v1/resolve", json={
            "name": "João Errado",
            "email": "joao@empresa.com",
            "cpf": "123.456.789-00",
        })
        record = client.get("/api/v1/database").json()[0]
        assert "joao@empresa.com" not in record["email"]
        assert "***" in record["cpf"]


class TestExpurge:
    def test_delete_from_queue(self, client):
        client.post("/api/v1/ingest", json=[INVALID])
        res = client.delete("/api/v1/review-queue/Jo%C3%A3o%20Errado")
        assert res.status_code == 204
        assert client.get("/api/v1/review-queue").json() == []

    def test_delete_nonexistent_returns_404(self, client):
        res = client.delete("/api/v1/review-queue/Nao%20Existe")
        assert res.status_code == 404


class TestReset:
    def test_reset_clears_all_state(self, client):
        client.post("/api/v1/ingest", json=[VALID, INVALID])
        client.delete("/api/v1/reset")
        assert client.get("/api/v1/database").json() == []
        assert client.get("/api/v1/review-queue").json() == []
