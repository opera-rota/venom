import pytest
from pydantic import ValidationError

from venom_contracts.models import ConnectorTarget, StepTemplate

CONNECTOR_ID = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e06"


def step(action: str) -> dict[str, object]:
    return {
        "action": action,
        "target": {"kind": "connector", "connector_id": CONNECTOR_ID},
        "requires_confirmation": True,
        "reversible": False,
        "on_failure": "abort",
    }


def test_accepts_a_step_from_the_fixed_menu() -> None:
    planned = StepTemplate.model_validate(step("call_connector"))
    assert isinstance(planned.target, ConnectorTarget)


def test_refuses_a_free_form_command() -> None:
    with pytest.raises(ValidationError):
        StepTemplate.model_validate(step("rm -rf C:\\"))
