import pytest

from venom_contracts.engines import get_engine
from venom_orchestrator.engines import EngineCatalogue, refresh
from venom_reasoning.errors import ReasoningError

pytestmark = pytest.mark.anyio


def test_offers_every_engine_until_the_model_list_is_known() -> None:
    catalogue = EngineCatalogue(("quick", "spare"))
    assert len(catalogue.available()) == 15
    assert catalogue.models("titan") == tuple(get_engine("titan").models)
    assert catalogue.understand_models() == ("quick", "spare")


def test_hides_models_that_are_not_offered() -> None:
    catalogue = EngineCatalogue(("quick", "spare"))
    catalogue.update({"anthropic/claude-sonnet-5.5": True, "quick": False, "spare": True})

    assert catalogue.models("titan") == ("anthropic/claude-sonnet-5.5",)
    assert catalogue.models("dove") == ()
    assert "dove" not in catalogue.available()
    assert catalogue.understand_models() == ("spare",)
    assert "google/gemini-2.5-flash-lite" in catalogue.missing()


async def test_keeps_the_last_known_list_when_the_check_fails() -> None:
    catalogue = EngineCatalogue(("quick",))
    catalogue.update({"anthropic/claude-sonnet-5.5": True})

    async def broken() -> dict[str, bool]:
        raise ReasoningError("unavailable", "offline")

    await refresh(catalogue, broken)
    assert catalogue.available() == ["utopia", "phantom", "nova", "titan", "oracle"]


def test_test_drive_answers_every_engine_with_free_models_that_can_use_tools() -> None:
    catalogue = EngineCatalogue(("anthropic/claude-haiku-5.5",), test_drive=True)
    catalogue.update(
        {
            "free/b:free": True,
            "free/a:free": True,
            "free/no-tools:free": False,
            "anthropic/claude-opus-5.5": True,
        }
    )

    assert catalogue.test_drive
    assert catalogue.models("utopia") == ("free/a:free", "free/b:free")
    assert catalogue.models("dove") == ("free/a:free", "free/b:free")
    assert catalogue.understand_models() == ("free/a:free", "free/b:free")
    assert len(catalogue.available()) == 15
    assert catalogue.missing() == []


def test_test_drive_offers_nothing_until_the_free_models_are_known() -> None:
    assert EngineCatalogue((), test_drive=True).available() == []
