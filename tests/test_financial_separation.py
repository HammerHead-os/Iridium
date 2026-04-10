"""Property-based tests for the Financial Separation Planner.

Each property test validates a correctness property from the design document.
LLM calls are mocked in all tests.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hypothesis import given, settings

from app.models.schemas import (
    SeparationPlan,
    SeparationPlanRequest,
    SeparationStep,
)
from app.services.financial_separation import (
    ALERTING_ACTIONS,
    FINANCIAL_AREAS,
    FinancialSeparationPlanner,
    _is_area_relevant,
)
from tests.conftest import (
    valid_plan_request_strategy,
    invalid_plan_request_strategy,
    separation_plan_strategy,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_llm() -> AsyncMock:
    """Create a mock LLM client that returns deterministic text."""
    client = AsyncMock()
    client.generate_content_async = AsyncMock(
        return_value=MagicMock(text="Generated guidance text for this step.")
    )
    return client


def _run(coro):
    """Run an async coroutine synchronously for Hypothesis tests."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# Property 1: Financial Area Coverage
# Feature: pathfinder-case-generator, Property 1: Financial Area Coverage
# ---------------------------------------------------------------------------

class TestProperty1FinancialAreaCoverage:
    """For any valid request with injunction_granted=True, the plan SHALL
    contain at least one step for each relevant financial area.
    **Validates: Requirements 1.1**
    """

    @given(case_data=valid_plan_request_strategy())
    @settings(max_examples=100)
    def test_financial_area_coverage(self, case_data: SeparationPlanRequest):
        planner = FinancialSeparationPlanner(llm_client=_make_mock_llm())
        plan = _run(planner.generate_plan(case_data))

        relevant_areas = {
            area for area in FINANCIAL_AREAS if _is_area_relevant(area, case_data)
        }
        areas_in_plan = {step.financial_area for step in plan.steps}

        for area in relevant_areas:
            assert area in areas_in_plan, (
                f"Expected area '{area}' in plan but it was missing"
            )


# ---------------------------------------------------------------------------
# Property 2: Safety Sequencing Invariant
# Feature: pathfinder-case-generator, Property 2: Safety Sequencing Invariant
# ---------------------------------------------------------------------------

class TestProperty2SafetySequencing:
    """For any generated plan, every alerting step SHALL have a higher
    sequencing_priority than every non-alerting step.
    **Validates: Requirements 1.2**
    """

    @given(case_data=valid_plan_request_strategy())
    @settings(max_examples=100)
    def test_safety_sequencing_invariant(self, case_data: SeparationPlanRequest):
        planner = FinancialSeparationPlanner(llm_client=_make_mock_llm())
        plan = _run(planner.generate_plan(case_data))

        if not plan.steps:
            return  # no steps to check

        max_safe = max(
            (s.sequencing_priority for s in plan.steps if not s.is_alerting_action),
            default=0,
        )
        min_alert = min(
            (s.sequencing_priority for s in plan.steps if s.is_alerting_action),
            default=float("inf"),
        )

        assert min_alert > max_safe, (
            f"Alerting min priority ({min_alert}) must be > "
            f"safe max priority ({max_safe})"
        )


# ---------------------------------------------------------------------------
# Property 3: Alerting Action Safety Notes
# Feature: pathfinder-case-generator, Property 3: Alerting Action Safety Notes
# ---------------------------------------------------------------------------

class TestProperty3AlertingSafetyNotes:
    """For any alerting step, safety_note SHALL be non-null and non-empty.
    **Validates: Requirements 1.3**
    """

    @given(case_data=valid_plan_request_strategy())
    @settings(max_examples=100)
    def test_alerting_steps_have_safety_notes(self, case_data: SeparationPlanRequest):
        planner = FinancialSeparationPlanner(llm_client=_make_mock_llm())
        plan = _run(planner.generate_plan(case_data))

        for step in plan.steps:
            if step.is_alerting_action:
                assert step.safety_note is not None, (
                    f"Alerting step '{step.title}' must have a safety_note"
                )
                assert len(step.safety_note.strip()) > 0, (
                    f"Alerting step '{step.title}' safety_note must be non-empty"
                )


# ---------------------------------------------------------------------------
# Property 4: Step Data Completeness
# Feature: pathfinder-case-generator, Property 4: Step Data Completeness
# ---------------------------------------------------------------------------

class TestProperty4StepDataCompleteness:
    """For any step, guidance SHALL be non-empty and every documents_needed
    entry SHALL be a non-empty string.
    **Validates: Requirements 1.4, 1.6**
    """

    @given(case_data=valid_plan_request_strategy())
    @settings(max_examples=100)
    def test_step_data_completeness(self, case_data: SeparationPlanRequest):
        planner = FinancialSeparationPlanner(llm_client=_make_mock_llm())
        plan = _run(planner.generate_plan(case_data))

        for step in plan.steps:
            assert len(step.guidance.strip()) > 0, (
                f"Step '{step.title}' guidance must be non-empty"
            )
            for doc in step.documents_needed:
                assert isinstance(doc, str) and len(doc.strip()) > 0, (
                    f"Step '{step.title}' has empty document entry"
                )


# ---------------------------------------------------------------------------
# Property 5: Pre-filled Document Structure
# Feature: pathfinder-case-generator, Property 5: Pre-filled Document Structure
# ---------------------------------------------------------------------------

class TestProperty5PrefilledDocumentStructure:
    """For any step with has_prefilled_document=True, generating the document
    SHALL return a PrefilledDocument with matching step_id, non-empty content
    and instructions.
    **Validates: Requirements 1.5**
    """

    @given(case_data=valid_plan_request_strategy())
    @settings(max_examples=100)
    def test_prefilled_document_structure(self, case_data: SeparationPlanRequest):
        planner = FinancialSeparationPlanner(llm_client=_make_mock_llm())
        plan = _run(planner.generate_plan(case_data))

        for step in plan.steps:
            if step.has_prefilled_document:
                doc = _run(planner.generate_prefilled_document(step, case_data))
                assert doc.step_id == step.step_id
                assert len(doc.content.strip()) > 0
                assert len(doc.instructions.strip()) > 0


# ---------------------------------------------------------------------------
# Property 6: Step Completion and Progress Tracking
# Feature: pathfinder-case-generator, Property 6: Step Completion and Progress Tracking
# ---------------------------------------------------------------------------

class TestProperty6StepCompletionProgress:
    """Marking a step as complete SHALL update completed, increment
    completed_count, recalculate percentage, and set next_recommended_step.
    **Validates: Requirements 1.7, 1.9**
    """

    @given(case_data=valid_plan_request_strategy())
    @settings(max_examples=100)
    def test_step_completion_tracking(self, case_data: SeparationPlanRequest):
        planner = FinancialSeparationPlanner(llm_client=_make_mock_llm())
        plan = _run(planner.generate_plan(case_data))

        if not plan.steps:
            return

        # Pick the first step and mark it complete
        target = plan.steps[0]
        old_completed = plan.progress.completed_count

        updated = planner.update_step_status(plan, target.step_id, True)

        # (a) step is marked completed
        matched = [s for s in updated.steps if s.step_id == target.step_id]
        assert len(matched) == 1
        assert matched[0].completed is True

        # (b) completed_count incremented
        assert updated.progress.completed_count == old_completed + 1

        # (c) percentage correct
        expected_pct = (
            updated.progress.completed_count / updated.progress.total_count * 100
        )
        assert abs(updated.progress.percentage - expected_pct) < 0.01

        # (d) next_recommended_step is first incomplete in priority order
        incomplete = sorted(
            [s for s in updated.steps if not s.completed],
            key=lambda s: s.sequencing_priority,
        )
        if incomplete:
            assert updated.next_recommended_step is not None
            assert updated.next_recommended_step.step_id == incomplete[0].step_id
        else:
            assert updated.next_recommended_step is None


# ---------------------------------------------------------------------------
# Property 7: Injunction Requirement Enforcement
# Feature: pathfinder-case-generator, Property 7: Injunction Requirement Enforcement
# ---------------------------------------------------------------------------

class TestProperty7InjunctionEnforcement:
    """For any request with injunction_granted=False, the planner SHALL
    reject with a validation error.
    **Validates: Requirements 1.8, 3.1**
    """

    @given(case_data=invalid_plan_request_strategy())
    @settings(max_examples=100)
    def test_injunction_required(self, case_data: SeparationPlanRequest):
        planner = FinancialSeparationPlanner(llm_client=_make_mock_llm())

        with pytest.raises(ValueError, match="injunction"):
            _run(planner.generate_plan(case_data))
