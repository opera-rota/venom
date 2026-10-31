from functools import cache
from importlib.resources import files

from pydantic import TypeAdapter

from venom_contracts.models import EngineId, EngineSpec

_engines_adapter = TypeAdapter(dict[EngineId, EngineSpec])


@cache
def load_engines() -> dict[EngineId, EngineSpec]:
    raw = files("venom_contracts").joinpath("engines.json").read_text(encoding="utf-8")
    return _engines_adapter.validate_json(raw)


def get_engine(engine: EngineId) -> EngineSpec:
    return load_engines()[engine]
