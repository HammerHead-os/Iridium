from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SeparationPlanRequest(BaseModel):
    injunction_granted: bool
    victim_name: str = Field(min_length=1)
    victim_address: str | None = None
    abuser_name: str = Field(min_length=1)
    joint_bank_accounts: list[str] = Field(default_factory=list)
    joint_utilities: list[str] = Field(default_factory=list)
    tenancy_type: Literal["joint_tenancy", "sole_tenancy", "mortgage"] | None = None
    has_joint_insurance: bool = False
    has_joint_debts: bool = False
    receives_joint_benefits: bool = False
    injunction_court: str | None = None
    injunction_date: str | None = None


class SeparationStep(BaseModel):
    step_id: str
    title: str
    financial_area: str
    sequencing_priority: int
    is_alerting_action: bool
    safety_note: str | None = None
    guidance: str
    documents_needed: list[str] = Field(default_factory=list)
    has_prefilled_document: bool = False
    completed: bool = False


class PrefilledDocument(BaseModel):
    step_id: str
    document_type: Literal["letter", "form", "application"]
    title: str
    content: str
    instructions: str


class PlanProgress(BaseModel):
    completed_count: int
    total_count: int
    percentage: float


class SeparationPlan(BaseModel):
    plan_id: str
    steps: list[SeparationStep]
    progress: PlanProgress
    next_recommended_step: SeparationStep | None = None


class ErrorResponse(BaseModel):
    error: str
    detail: list[dict]
