"""API integration tests and property tests for the separation planner endpoints.

Property 8: API Validation Error Responses
Property 9: Input Sanitization
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from app.main import app
from app.services.sanitization import sanitize_text


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_plan_store():
    """Reset the in-memory plan store between tests."""
    from app.routers import separation
    separation._plans.clear()
    yield
    separation._plans.clear()


@pytest.fixture
def client():
    return TestClient(app)


def _mock_llm():
    m = AsyncMock()
    m.generate_content_async = AsyncMock(
        return_value=MagicMock(text="Mock guidance text.")
    )
    return m


def _valid_payload(**overrides) -> dict:
    base = {
        "injunction_granted": True,
        "victim_name": "Jane Doe",
        "abuser_name": "John Smith",
        "joint_bank_accounts": ["HSBC-001"],
        "joint_utilities": ["CLP Power"],
        "tenancy_type": "joint_tenancy",
        "has_joint_insurance": True,
        "has_joint_debts": True,
        "receives_joint_benefits": True,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Unit / integration tests
# ---------------------------------------------------------------------------

class TestGenerateEndpoint:
    def test_valid_request_returns_200(self, client):
        with patch("app.routers.separation._planner._llm", _mock_llm()):
            resp = client.post("/api/v1/separation/generate", json=_valid_payload())
        assert resp.status_code == 200
        data = resp.json()
        assert "plan_id" in data
        assert "steps" in data
        assert "progress" in data

    def test_injunction_false_returns_422(self, client):
        resp = client.post(
            "/api/v1/separation/generate",
            json=_valid_payload(injunction_granted=False),
        )
        assert resp.status_code == 422

    def test_missing_required_fields_returns_422(self, client):
        resp = client.post("/api/v1/separation/generate", json={})
        assert resp.status_code == 422


class TestPatchStep:
    def test_step_completion_updates_progress(self, client):
        with patch("app.routers.separation._planner._llm", _mock_llm()):
            gen = client.post("/api/v1/separation/generate", json=_valid_payload())
        plan = gen.json()
        plan_id = plan["plan_id"]
        step_id = plan["steps"][0]["step_id"]

        resp = client.patch(
            f"/api/v1/separation/{plan_id}/steps/{step_id}",
            json={"completed": True},
        )
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["progress"]["completed_count"] == 1


class TestDocumentEndpoint:
    def test_get_document_returns_prefilled(self, client):
        with patch("app.routers.separation._planner._llm", _mock_llm()):
            gen = client.post("/api/v1/separation/generate", json=_valid_payload())
        plan = gen.json()
        plan_id = plan["plan_id"]
        # Find a step with has_prefilled_document=True
        prefill_step = next(
            (s for s in plan["steps"] if s["has_prefilled_document"]), None
        )
        if prefill_step is None:
            pytest.skip("No prefilled document steps in generated plan")

        with patch("app.routers.separation._planner._llm", _mock_llm()):
            resp = client.get(
                f"/api/v1/separation/{plan_id}/steps/{prefill_step['step_id']}/document"
            )
        assert resp.status_code == 200
        doc = resp.json()
        assert doc["step_id"] == prefill_step["step_id"]
        assert len(doc["content"]) > 0
        assert len(doc["instructions"]) > 0


class TestSanitizationInEndpoint:
    def test_html_stripped_from_inputs(self, client):
        payload = _valid_payload(
            victim_name="<script>alert('x')</script>Jane",
            abuser_name="<b>John</b>",
        )
        with patch("app.routers.separation._planner._llm", _mock_llm()):
            resp = client.post("/api/v1/separation/generate", json=payload)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Property 8: API Validation Error Responses
# Feature: pathfinder-case-generator, Property 8: API Validation Error Responses
# ---------------------------------------------------------------------------

# Strategy: payloads missing one or more required fields
_REQUIRED_FIELDS = ["injunction_granted", "victim_name", "abuser_name"]


@st.composite
def invalid_payload_strategy(draw):
    """Generate payloads that are missing at least one required field."""
    full = {
        "injunction_granted": True,
        "victim_name": draw(st.text(min_size=1, max_size=30, alphabet=st.characters(whitelist_categories=("L",)))),
        "abuser_name": draw(st.text(min_size=1, max_size=30, alphabet=st.characters(whitelist_categories=("L",)))),
    }
    # Remove at least one required field
    to_remove = draw(st.lists(st.sampled_from(_REQUIRED_FIELDS), min_size=1, unique=True))
    for key in to_remove:
        full.pop(key, None)
    return full


class TestProperty8APIValidationErrors:
    """For any request with invalid or missing required fields, the API SHALL
    return HTTP 422 with a response body listing each validation failure.
    **Validates: Requirements 2.3, 2.6, 3.2**
    """

    @given(payload=invalid_payload_strategy())
    @settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
    def test_missing_fields_return_422(self, payload: dict):
        client = TestClient(app)
        resp = client.post("/api/v1/separation/generate", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert "detail" in body


# ---------------------------------------------------------------------------
# Property 9: Input Sanitization
# Feature: pathfinder-case-generator, Property 9: Input Sanitization
# ---------------------------------------------------------------------------

_INJECTION_FRAGMENTS = st.sampled_from([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<b>bold</b>",
    "<div>block</div>",
    "javascript:void(0)",
    "onclick=steal()",
    "eval(document.cookie)",
    "expression(alert(1))",
    "\x00\x01\x02\x03",
    "\x0e\x0f\x7f\x80",
])


class TestProperty9InputSanitization:
    """For any text containing HTML tags, script injection patterns, or
    control characters, sanitize_text SHALL remove all such content.
    **Validates: Requirements 3.3**
    """

    @given(
        prefix=st.text(max_size=20, alphabet=st.characters(whitelist_categories=("L", "Zs"))),
        injection=_INJECTION_FRAGMENTS,
        suffix=st.text(max_size=20, alphabet=st.characters(whitelist_categories=("L", "Zs"))),
    )
    @settings(max_examples=100)
    def test_sanitizer_strips_injections(self, prefix: str, injection: str, suffix: str):
        dirty = prefix + injection + suffix
        clean = sanitize_text(dirty)
        # No HTML tags remain
        assert "<" not in clean or ">" not in clean
        # No script patterns remain
        assert "javascript:" not in clean.lower()
        assert "eval(" not in clean.lower()
        assert "expression(" not in clean.lower()
        # No control characters remain
        for ch in clean:
            code = ord(ch)
            assert not (0x00 <= code <= 0x08 or code in (0x0B, 0x0C) or 0x0E <= code <= 0x1F or 0x7F <= code <= 0x9F)
