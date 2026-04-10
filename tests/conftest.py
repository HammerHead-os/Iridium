from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hypothesis import strategies as st

from app.models.schemas import (
    PlanProgress,
    SeparationPlan,
    SeparationPlanRequest,
    SeparationStep,
)

FINANCIAL_AREAS = [
    "bank_accounts",
    "utilities",
    "tenancy_mortgage",
    "insurance",
    "debts",
    "benefits_tax_credits",
]

TENANCY_TYPES = ["joint_tenancy", "sole_tenancy", "mortgage", None]


# ---------------------------------------------------------------------------
# Hypothesis strategies
# ---------------------------------------------------------------------------

def separation_plan_request_strategy(
    injunction_granted: st.SearchStrategy[bool] | None = None,
) -> st.SearchStrategy[SeparationPlanRequest]:
    """Strategy for generating SeparationPlanRequest instances."""
    return st.builds(
        SeparationPlanRequest,
        injunction_granted=injunction_granted if injunction_granted is not None else st.booleans(),
        victim_name=st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=("L", "Zs"))),
        victim_address=st.one_of(st.none(), st.text(min_size=1, max_size=100)),
        abuser_name=st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=("L", "Zs"))),
        joint_bank_accounts=st.lists(st.text(min_size=1, max_size=30), max_size=5),
        joint_utilities=st.lists(st.text(min_size=1, max_size=30), max_size=5),
        tenancy_type=st.sampled_from(TENANCY_TYPES),
        has_joint_insurance=st.booleans(),
        has_joint_debts=st.booleans(),
        receives_joint_benefits=st.booleans(),
        injunction_court=st.one_of(st.none(), st.text(min_size=1, max_size=50)),
        injunction_date=st.one_of(st.none(), st.from_regex(r"\d{4}-\d{2}-\d{2}", fullmatch=True)),
    )


def valid_plan_request_strategy() -> st.SearchStrategy[SeparationPlanRequest]:
    """Strategy that always produces requests with injunction_granted=True."""
    return separation_plan_request_strategy(injunction_granted=st.just(True))


def invalid_plan_request_strategy() -> st.SearchStrategy[SeparationPlanRequest]:
    """Strategy that always produces requests with injunction_granted=False."""
    return separation_plan_request_strategy(injunction_granted=st.just(False))


def separation_step_strategy(
    is_alerting: st.SearchStrategy[bool] | None = None,
) -> st.SearchStrategy[SeparationStep]:
    """Strategy for generating SeparationStep instances."""
    return st.builds(
        SeparationStep,
        step_id=st.uuids().map(str),
        title=st.text(min_size=1, max_size=80),
        financial_area=st.sampled_from(FINANCIAL_AREAS),
        sequencing_priority=st.integers(min_value=1, max_value=100),
        is_alerting_action=is_alerting if is_alerting is not None else st.booleans(),
        safety_note=st.one_of(st.none(), st.text(min_size=1, max_size=200)),
        guidance=st.text(min_size=1, max_size=300),
        documents_needed=st.lists(st.text(min_size=1, max_size=60), max_size=5),
        has_prefilled_document=st.booleans(),
        completed=st.just(False),
    )


def separation_plan_strategy() -> st.SearchStrategy[SeparationPlan]:
    """Strategy for generating SeparationPlan with consistent progress tracking."""

    @st.composite
    def _build(draw: st.DrawFn) -> SeparationPlan:
        # Generate non-alerting steps (lower priority) then alerting steps (higher)
        non_alerting = draw(
            st.lists(separation_step_strategy(is_alerting=st.just(False)), min_size=1, max_size=4)
        )
        alerting = draw(
            st.lists(separation_step_strategy(is_alerting=st.just(True)), min_size=0, max_size=3)
        )

        # Assign sequencing priorities so non-alerting < alerting
        all_steps: list[SeparationStep] = []
        for i, step in enumerate(non_alerting):
            all_steps.append(step.model_copy(update={"sequencing_priority": i + 1}))
        base = len(non_alerting)
        for i, step in enumerate(alerting):
            all_steps.append(step.model_copy(update={"sequencing_priority": base + i + 1}))

        # Mark some steps as completed
        completed_flags = draw(
            st.lists(st.booleans(), min_size=len(all_steps), max_size=len(all_steps))
        )
        for idx, flag in enumerate(completed_flags):
            all_steps[idx] = all_steps[idx].model_copy(update={"completed": flag})

        completed_count = sum(1 for s in all_steps if s.completed)
        total = len(all_steps)
        pct = (completed_count / total * 100) if total else 0.0

        next_step = next((s for s in all_steps if not s.completed), None)

        return SeparationPlan(
            plan_id=draw(st.uuids().map(str)),
            steps=all_steps,
            progress=PlanProgress(
                completed_count=completed_count,
                total_count=total,
                percentage=round(pct, 2),
            ),
            next_recommended_step=next_step,
        )

    return _build()


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_vertex_ai_client():
    """A mock Vertex AI / Gemini client that returns canned responses."""
    client = AsyncMock()
    # Default: return a simple guidance string
    client.generate_content_async = AsyncMock(
        return_value=MagicMock(text="Generated guidance text for this step.")
    )
    return client


@pytest.fixture
def planner(mock_vertex_ai_client):
    """FinancialSeparationPlanner instance with a mocked LLM client."""
    from app.services.financial_separation import FinancialSeparationPlanner

    return FinancialSeparationPlanner(llm_client=mock_vertex_ai_client)
