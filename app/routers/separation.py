"""Separation planner API router."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import (
    PrefilledDocument,
    SeparationPlan,
    SeparationPlanRequest,
)
from app.services.financial_separation import FinancialSeparationPlanner
from app.services.sanitization import sanitize_text

router = APIRouter(prefix="/api/v1/separation", tags=["separation"])

# In-memory plan store (keyed by plan_id)
_plans: dict[str, tuple[SeparationPlan, SeparationPlanRequest]] = {}

# Shared planner instance (LLM client injected at app startup or left None for now)
_planner = FinancialSeparationPlanner()


class StepStatusUpdate(BaseModel):
    completed: bool


@router.post("/generate", response_model=SeparationPlan)
async def generate_plan(request: SeparationPlanRequest) -> SeparationPlan:
    """Generate a financial separation plan."""
    if not request.injunction_granted:
        raise HTTPException(
            status_code=422,
            detail=[{
                "loc": ["body", "injunction_granted"],
                "msg": "A granted non-molestation injunction is required before financial separation planning can proceed.",
                "type": "value_error",
            }],
        )
    # Sanitize all text fields before passing to service / LLM
    request = request.model_copy(
        update={
            "victim_name": sanitize_text(request.victim_name),
            "abuser_name": sanitize_text(request.abuser_name),
            "victim_address": sanitize_text(request.victim_address) if request.victim_address else None,
            "injunction_court": sanitize_text(request.injunction_court) if request.injunction_court else None,
        }
    )
    plan = await _planner.generate_plan(request)
    _plans[plan.plan_id] = (plan, request)
    return plan


@router.get("/{plan_id}", response_model=SeparationPlan)
async def get_plan(plan_id: str) -> SeparationPlan:
    """Retrieve an existing plan by ID."""
    entry = _plans.get(plan_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=[{"msg": f"Plan '{plan_id}' not found."}])
    return entry[0]


@router.patch("/{plan_id}/steps/{step_id}", response_model=SeparationPlan)
async def update_step(plan_id: str, step_id: str, body: StepStatusUpdate) -> SeparationPlan:
    """Update the completion status of a step."""
    entry = _plans.get(plan_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=[{"msg": f"Plan '{plan_id}' not found."}])
    plan, case_data = entry
    try:
        updated = _planner.update_step_status(plan, step_id, body.completed)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=[{"msg": str(exc)}])
    _plans[plan_id] = (updated, case_data)
    return updated


@router.get("/{plan_id}/steps/{step_id}/document", response_model=PrefilledDocument)
async def get_document(plan_id: str, step_id: str) -> PrefilledDocument:
    """Generate a pre-filled document for a step."""
    entry = _plans.get(plan_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=[{"msg": f"Plan '{plan_id}' not found."}])
    plan, case_data = entry
    step = next((s for s in plan.steps if s.step_id == step_id), None)
    if step is None:
        raise HTTPException(status_code=404, detail=[{"msg": f"Step '{step_id}' not found."}])
    doc = await _planner.generate_prefilled_document(step, case_data)
    return doc
