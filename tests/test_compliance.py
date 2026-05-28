"""
Compliance test suite — covers the three features added for ICP readiness:

  1. is_sensitive   — prompt masking: real values never reach Claude for flagged fields
  2. Rate limiter   — per-plan sliding-window limits; tenant isolation
  3. legal_basis    — stored as dedicated column; surfaces in audit log on approval
"""

import json
from unittest.mock import patch

import pytest
import repository

from api import _build_diagnosis_prompt, _TenantRateLimiter, _PLAN_RATE_LIMITS


# ---------------------------------------------------------------------------
# Shared fixtures / payloads
# ---------------------------------------------------------------------------

INVALID_WITH_LEGAL_BASIS = {
    "name": "Pedro Compliance",
    "email": "pedro.invalido.com",   # no @ → fails email validation → goes to queue
    "cpf": "123.456.789-00",
    "legal_basis": "consentimento",
}

VALID_WITH_LEGAL_BASIS = {
    "name": "Ana Legal",
    "email": "ana@empresa.com",
    "cpf": "123.456.789-00",
    "legal_basis": "obrigacao_legal",
}


# ---------------------------------------------------------------------------
# 1. is_sensitive — unit tests on the prompt-building function (no HTTP, no Claude)
# ---------------------------------------------------------------------------

class TestSensitiveFieldPrompt:
    def test_sensitive_field_marked_in_field_description(self):
        schema = [
            {"field_key": "diag", "label": "Diagnóstico Médico", "field_type": "text", "is_sensitive": True},
        ]
        prompt = _build_diagnosis_prompt(schema)
        assert "DADO SENSÍVEL" in prompt
        assert "valor não transmitido" in prompt

    def test_non_sensitive_field_not_marked(self):
        schema = [
            {"field_key": "email", "label": "E-mail", "field_type": "email", "is_sensitive": False},
        ]
        prompt = _build_diagnosis_prompt(schema)
        field_lines = [l for l in prompt.splitlines() if "E-mail" in l]
        assert field_lines
        assert "DADO SENSÍVEL" not in field_lines[0]

    def test_mixed_schema_marks_only_sensitive_field(self):
        schema = [
            {"field_key": "email", "label": "E-mail", "field_type": "email", "is_sensitive": False},
            {"field_key": "diag", "label": "Diagnóstico Médico", "field_type": "text", "is_sensitive": True},
        ]
        prompt = _build_diagnosis_prompt(schema)
        # The sensitive field line is marked
        diag_lines = [l for l in prompt.splitlines() if "Diagnóstico Médico" in l]
        assert diag_lines
        assert "DADO SENSÍVEL" in diag_lines[0]
        # The non-sensitive field line is NOT marked
        email_lines = [l for l in prompt.splitlines() if "E-mail" in l]
        assert email_lines
        assert "DADO SENSÍVEL" not in email_lines[0]

    def test_importante_warning_always_present(self):
        schema = [{"field_key": "cpf", "label": "CPF", "field_type": "cpf", "is_sensitive": True}]
        prompt = _build_diagnosis_prompt(schema)
        assert "IMPORTANTE" in prompt
        assert "não tente inferir" in prompt

    def test_all_three_sensitive_fields_all_marked(self):
        schema = [
            {"field_key": "a", "label": "Campo A", "field_type": "text", "is_sensitive": True},
            {"field_key": "b", "label": "Campo B", "field_type": "text", "is_sensitive": True},
            {"field_key": "c", "label": "Campo C", "field_type": "text", "is_sensitive": True},
        ]
        prompt = _build_diagnosis_prompt(schema)
        # 3 field-description markers + 1 in the IMPORTANTE paragraph = 4 total
        assert prompt.count("DADO SENSÍVEL") == 4


# ---------------------------------------------------------------------------
# 2. Rate limiter — unit tests (instantiate class directly, mock DB call)
# ---------------------------------------------------------------------------

class TestRateLimiter:
    def _limiter_for(self, plan: str) -> _TenantRateLimiter:
        limiter = _TenantRateLimiter()
        with patch.object(
            repository, "get_tenant_subscription", return_value={"effective_plan": plan}
        ):
            limiter._resolve_plan("warmup_tenant")  # pre-warm cache
        return limiter

    def test_plan_constants_are_ordered_correctly(self):
        assert _PLAN_RATE_LIMITS["starter"] < _PLAN_RATE_LIMITS["pro"]
        assert _PLAN_RATE_LIMITS["pro"] < _PLAN_RATE_LIMITS["professional"]
        assert _PLAN_RATE_LIMITS["professional"] < _PLAN_RATE_LIMITS["enterprise"]

    def test_starter_allows_up_to_its_limit(self):
        limiter = _TenantRateLimiter()
        limit = _PLAN_RATE_LIMITS["starter"]
        with patch.object(repository, "get_tenant_subscription", return_value={"effective_plan": "starter"}):
            for _ in range(limit):
                limiter.check("t_starter")  # must not raise

    def test_starter_blocks_one_over_limit(self):
        from fastapi import HTTPException
        limiter = _TenantRateLimiter()
        limit = _PLAN_RATE_LIMITS["starter"]
        with patch.object(repository, "get_tenant_subscription", return_value={"effective_plan": "starter"}):
            for _ in range(limit):
                limiter.check("t_over")
            with pytest.raises(HTTPException) as exc:
                limiter.check("t_over")
        assert exc.value.status_code == 429
        assert "Retry-After" in exc.value.headers

    def test_unknown_plan_falls_back_to_starter_limit(self):
        from fastapi import HTTPException
        limiter = _TenantRateLimiter()
        limit = _PLAN_RATE_LIMITS["starter"]
        with patch.object(repository, "get_tenant_subscription", return_value={"effective_plan": "nonexistent"}):
            for _ in range(limit):
                limiter.check("t_unknown")
            with pytest.raises(HTTPException) as exc:
                limiter.check("t_unknown")
        assert exc.value.status_code == 429

    def test_tenants_have_independent_buckets(self):
        from fastapi import HTTPException
        limiter = _TenantRateLimiter()
        limit = _PLAN_RATE_LIMITS["starter"]
        with patch.object(repository, "get_tenant_subscription", return_value={"effective_plan": "starter"}):
            for _ in range(limit):
                limiter.check("tenant_a")
            with pytest.raises(HTTPException):
                limiter.check("tenant_a")
            # tenant_b is independent — should NOT be blocked
            limiter.check("tenant_b")

    def test_plan_cache_prevents_extra_db_calls(self):
        limiter = _TenantRateLimiter()
        with patch.object(
            repository, "get_tenant_subscription", return_value={"effective_plan": "starter"}
        ) as mock_sub:
            for _ in range(5):
                limiter.check("t_cache")
            # DB should only be called once — subsequent calls use the 5-min cache
            assert mock_sub.call_count == 1


# ---------------------------------------------------------------------------
# 3. legal_basis — integration tests via HTTP
# ---------------------------------------------------------------------------

class TestLegalBasis:
    def test_ingest_with_legal_basis_succeeds(self, client):
        res = client.post("/api/v1/ingest", json=[INVALID_WITH_LEGAL_BASIS])
        assert res.status_code == 202
        data = res.json()
        assert data["registros_fila_revisao"] == 1

    def test_legal_basis_in_audit_log_after_manual_approve(self, client):
        client.post("/api/v1/ingest", json=[INVALID_WITH_LEGAL_BASIS])
        client.post("/api/v1/resolve", json={
            "name": "Pedro Compliance",
            "email": "pedro@empresa.com",
            "cpf": "123.456.789-00",
        })
        logs = client.get("/api/v1/audit-logs").json()
        approve = next((l for l in logs if l["action"] == "APPROVE_MANUAL"), None)
        assert approve is not None

        fields = approve["fields_affected"]
        if isinstance(fields, str):
            fields = json.loads(fields)
        assert fields.get("legal_basis") == "consentimento"

    def test_expurge_does_not_record_legal_basis(self, client):
        client.post("/api/v1/ingest", json=[INVALID_WITH_LEGAL_BASIS])
        client.delete("/api/v1/review-queue/Pedro%20Compliance")
        logs = client.get("/api/v1/audit-logs").json()
        expurge = next((l for l in logs if l["action"] == "EXPURGO"), None)
        assert expurge is not None
        fields = expurge["fields_affected"]
        if isinstance(fields, str):
            fields = json.loads(fields)
        assert "legal_basis" not in fields

    def test_valid_record_with_legal_basis_goes_to_clean_db(self, client):
        res = client.post("/api/v1/ingest", json=[VALID_WITH_LEGAL_BASIS])
        assert res.status_code == 202
        data = res.json()
        assert data["registros_banco_limpo"] == 1
        assert data["registros_fila_revisao"] == 0

    def test_legal_basis_in_bulk_resolve_audit_log(self, client):
        client.post("/api/v1/ingest", json=[INVALID_WITH_LEGAL_BASIS])
        client.post("/api/v1/bulk-resolve", json={
            "mode": "all",
            "items": [{"name": "Pedro Compliance", "email": "pedro@empresa.com", "cpf": "123.456.789-00"}],
        })
        logs = client.get("/api/v1/audit-logs").json()
        bulk = next((l for l in logs if l["action"] == "APPROVE_BULK"), None)
        assert bulk is not None
        fields = bulk["fields_affected"]
        if isinstance(fields, str):
            fields = json.loads(fields)
        assert fields.get("legal_basis") == "consentimento"
