from typing import get_args

from venom_contracts.engines import get_engine, load_engines
from venom_contracts.models import EngineId


def test_every_engine_id_has_a_spec() -> None:
    assert set(load_engines()) == set(get_args(EngineId.__value__))


def test_engine_spec_carries_its_models() -> None:
    utopia = get_engine("utopia")
    assert utopia.id == "utopia"
    assert utopia.class_ == "titan"
    assert len(utopia.models) >= 1
