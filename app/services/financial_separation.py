"""Financial Separation Planner service.

Generates safely sequenced financial separation plans for DV victims
with a granted non-molestation injunction.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.models.schemas import (
    PlanProgress,
    PrefilledDocument,
    SeparationPlan,
    SeparationPlanRequest,
    SeparationStep,
)

FINANCIAL_AREAS: list[str] = [
    "bank_accounts",
    "utilities",
    "tenancy_mortgage",
    "insurance",
    "debts",
    "benefits_tax_credits",
]

ALERTING_ACTIONS: set[str] = {
    "close_joint_account",
    "redirect_mail",
    "remove_name_from_joint_mortgage",
    "cancel_joint_insurance",
    "notify_joint_creditors",
}

# Maps each financial area to the steps generated for it.
# Each entry: (action_id, title, is_alerting, has_prefilled_doc)
_AREA_STEPS: dict[str, list[tuple[str, str, bool, bool]]] = {
    "bank_accounts": [
        ("open_sole_account", "Open a sole bank account", False, False),
        ("redirect_income", "Redirect income to sole account", False, False),
        ("close_joint_account", "Close joint bank account", True, True),
    ],
    "utilities": [
        ("transfer_utilities", "Transfer utilities to your name", False, True),
        ("redirect_mail", "Redirect mail to safe address", True, False),
    ],
    "tenancy_mortgage": [
        ("review_tenancy", "Review tenancy or mortgage agreement", False, False),
        ("remove_name_from_joint_mortgage", "Remove abuser from joint mortgage", True, True),
    ],
    "insurance": [
        ("get_sole_insurance", "Get sole insurance policy", False, False),
        ("cancel_joint_insurance", "Cancel joint insurance policy", True, True),
    ],
    "debts": [
        ("assess_joint_debts", "Assess joint debts and liabilities", False, False),
        ("notify_joint_creditors", "Notify creditors of separation", True, True),
    ],
    "benefits_tax_credits": [
        ("apply_sole_benefits", "Apply for sole benefits or tax credits", False, True),
    ],
}


def _is_area_relevant(area: str, case_data: SeparationPlanRequest) -> bool:
    """Return True if the financial area is relevant given the victim's case data."""
    if area == "bank_accounts":
        return len(case_data.joint_bank_accounts) > 0
    if area == "utilities":
        return len(case_data.joint_utilities) > 0
    if area == "tenancy_mortgage":
        return case_data.tenancy_type is not None
    if area == "insurance":
        return case_data.has_joint_insurance
    if area == "debts":
        return case_data.has_joint_debts
    if area == "benefits_tax_credits":
        return case_data.receives_joint_benefits
    return False


class FinancialSeparationPlanner:
    """Generates safely sequenced financial separation plans."""

    def __init__(self, llm_client: Any = None) -> None:
        self._llm = llm_client

    # ------------------------------------------------------------------
    # Plan generation
    # ------------------------------------------------------------------

    async def generate_plan(
        self, case_data: SeparationPlanRequest
    ) -> SeparationPlan:
        """Generate a full separation plan for the given case data.

        Raises ValueError if injunction_granted is False.
        """
        if not case_data.injunction_granted:
            raise ValueError(
                "A granted non-molestation injunction is required before "
                "financial separation planning can proceed."
            )

        steps: list[SeparationStep] = []
        # Priority counters: non-alerting get low numbers, alerting get high.
        safe_priority = 1
        alert_priority = 100  # start alerting actions at 100

        for area in FINANCIAL_AREAS:
            if not _is_area_relevant(area, case_data):
                continue
            for action_id, title, is_alerting, has_prefill in _AREA_STEPS.get(area, []):
                if is_alerting:
                    priority = alert_priority
                    alert_priority += 1
                else:
                    priority = safe_priority
                    safe_priority += 1

                guidance = await self._generate_guidance(title, area, case_data)
                safety_note = (
                    await self._generate_safety_note(title, case_data)
                    if is_alerting
                    else None
                )
                documents_needed = await self._generate_documents_needed(title, area, case_data)

                steps.append(
                    SeparationStep(
                        step_id=str(uuid.uuid4()),
                        title=title,
                        financial_area=area,
                        sequencing_priority=priority,
                        is_alerting_action=is_alerting,
                        safety_note=safety_note,
                        guidance=guidance,
                        documents_needed=documents_needed,
                        has_prefilled_document=has_prefill,
                        completed=False,
                    )
                )

        # Sort by sequencing_priority so safe steps come first
        steps.sort(key=lambda s: s.sequencing_priority)

        total = len(steps)
        progress = PlanProgress(completed_count=0, total_count=total, percentage=0.0)
        next_step = steps[0] if steps else None

        return SeparationPlan(
            plan_id=str(uuid.uuid4()),
            steps=steps,
            progress=progress,
            next_recommended_step=next_step,
        )

    # ------------------------------------------------------------------
    # Pre-filled document generation
    # ------------------------------------------------------------------

    async def generate_prefilled_document(
        self, step: SeparationStep, case_data: SeparationPlanRequest
    ) -> PrefilledDocument:
        """Generate a pre-filled draft document for the given step."""
        prompt = (
            f"Generate a pre-filled {step.title} document for {case_data.victim_name}. "
            f"Abuser: {case_data.abuser_name}. Financial area: {step.financial_area}. "
            "Provide a professional draft ready for review."
        )
        response = await self._llm.generate_content_async(prompt)
        content = response.text

        instructions_prompt = (
            f"Provide brief instructions on how to submit this {step.title} document."
        )
        instr_response = await self._llm.generate_content_async(instructions_prompt)
        instructions = instr_response.text

        doc_type = "letter"
        if "application" in step.title.lower() or "apply" in step.title.lower():
            doc_type = "application"
        elif "form" in step.title.lower() or "transfer" in step.title.lower():
            doc_type = "form"

        return PrefilledDocument(
            step_id=step.step_id,
            document_type=doc_type,
            title=f"Draft: {step.title}",
            content=content,
            instructions=instructions,
        )

    # ------------------------------------------------------------------
    # Step completion tracking
    # ------------------------------------------------------------------

    def update_step_status(
        self, plan: SeparationPlan, step_id: str, completed: bool
    ) -> SeparationPlan:
        """Mark a step complete/incomplete and recalculate progress."""
        updated_steps: list[SeparationStep] = []
        found = False
        for step in plan.steps:
            if step.step_id == step_id:
                found = True
                updated_steps.append(step.model_copy(update={"completed": completed}))
            else:
                updated_steps.append(step)

        if not found:
            raise ValueError(f"Step '{step_id}' not found in plan '{plan.plan_id}'.")

        completed_count = sum(1 for s in updated_steps if s.completed)
        total = len(updated_steps)
        pct = (completed_count / total * 100) if total else 0.0

        next_step = self._find_next_step(updated_steps)

        return SeparationPlan(
            plan_id=plan.plan_id,
            steps=updated_steps,
            progress=PlanProgress(
                completed_count=completed_count,
                total_count=total,
                percentage=pct,
            ),
            next_recommended_step=next_step,
        )

    def get_next_recommended_step(
        self, plan: SeparationPlan
    ) -> SeparationStep | None:
        """Return the first incomplete step in sequencing order, or None."""
        return self._find_next_step(plan.steps)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _find_next_step(steps: list[SeparationStep]) -> SeparationStep | None:
        sorted_steps = sorted(steps, key=lambda s: s.sequencing_priority)
        return next((s for s in sorted_steps if not s.completed), None)

    async def _generate_guidance(
        self, title: str, area: str, case_data: SeparationPlanRequest
    ) -> str:
        prompt = (
            f"Provide proactive guidance for the step '{title}' in the "
            f"'{area}' financial area for {case_data.victim_name}. "
            "Include: concrete next action, documents needed, "
            "location/contact, and a plain-language explanation."
        )
        response = await self._llm.generate_content_async(prompt)
        return response.text

    async def _generate_safety_note(
        self, title: str, case_data: SeparationPlanRequest
    ) -> str:
        prompt = (
            f"Generate a safety note for the alerting action '{title}'. "
            f"The victim ({case_data.victim_name}) has a granted injunction. "
            "Explain the risk and confirm injunction protection is in place."
        )
        response = await self._llm.generate_content_async(prompt)
        return response.text

    async def _generate_documents_needed(
        self, title: str, area: str, case_data: SeparationPlanRequest
    ) -> list[str]:
        prompt = (
            f"List the specific documents needed for '{title}' in the "
            f"'{area}' area. Include retrieval instructions for each."
        )
        response = await self._llm.generate_content_async(prompt)
        # Split LLM response into individual document entries
        lines = [
            line.strip().lstrip("•-0123456789. ")
            for line in response.text.strip().split("\n")
            if line.strip()
        ]
        return [line for line in lines if line]
