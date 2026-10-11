from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from venom_contracts import models

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def fixtures(kind: str) -> list[Path]:
    return sorted((FIXTURES / kind).glob("*.json"))


def adapter_for(path: Path) -> TypeAdapter[object]:
    shape = path.name.split(".")[0]
    return TypeAdapter(getattr(models, shape))


@pytest.mark.parametrize("path", fixtures("valid"), ids=lambda path: path.name)
def test_accepts_valid_fixture(path: Path) -> None:
    adapter_for(path).validate_json(path.read_bytes())


@pytest.mark.parametrize("path", fixtures("invalid"), ids=lambda path: path.name)
def test_rejects_invalid_fixture(path: Path) -> None:
    with pytest.raises(ValidationError):
        adapter_for(path).validate_json(path.read_bytes())
