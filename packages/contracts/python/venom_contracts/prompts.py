from functools import cache
from importlib.resources import files

from pydantic import TypeAdapter

from venom_contracts.models import Prompt, PromptRole

_prompts_adapter = TypeAdapter(dict[PromptRole, Prompt])


@cache
def load_prompts() -> dict[PromptRole, Prompt]:
    raw = files("venom_contracts").joinpath("prompts.json").read_text(encoding="utf-8")
    return _prompts_adapter.validate_json(raw)


def get_prompt(role: PromptRole) -> Prompt:
    return load_prompts()[role]
