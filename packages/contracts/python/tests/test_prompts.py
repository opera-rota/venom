from typing import get_args

from venom_contracts.models import PromptRole
from venom_contracts.prompts import get_prompt, load_prompts


def test_every_role_has_a_prompt() -> None:
    assert set(load_prompts()) == set(get_args(PromptRole.__value__))


def test_prompt_matches_its_role() -> None:
    plan = get_prompt("plan")
    assert plan.role == "plan"
    assert plan.version >= 1
