import pytest

from venom_contracts.engines import get_engine
from venom_orchestrator.engines import EngineCatalogue, refresh
from venom_reasoning.errors import ReasoningError
from venom_reasoning.openrouter_provider import ListedModel

pytestmark = pytest.mark.anyio

TOOLS = ListedModel(tools=True, sees=False)
NO_TOOLS = ListedModel(tools=False, sees=False)
SEES = ListedModel(tools=True, sees=True)


def test_offers_every_engine_until_the_model_list_is_known() -> None:
    catalogue = EngineCatalogue(("quick", "spare"))
    assert len(catalogue.available()) == 15
    assert catalogue.models("titan") == tuple(get_engine("titan").models)
    assert catalogue.understand_models() == ("quick", "spare")


def test_hides_models_that_are_not_offered() -> None:
    catalogue = EngineCatalogue(("quick", "spare"))
    catalogue.update({"anthropic/claude-sonnet-5.5": TOOLS, "quick": NO_TOOLS, "spare": TOOLS})

    assert catalogue.models("titan") == ("anthropic/claude-sonnet-5.5",)
    assert catalogue.models("dove") == ()
    assert "dove" not in catalogue.available()
    assert catalogue.understand_models() == ("spare",)
    assert "google/gemini-2.5-flash-lite" in catalogue.missing()


async def test_keeps_the_last_known_list_when_the_check_fails() -> None:
    catalogue = EngineCatalogue(("quick",))
    catalogue.update({"anthropic/claude-sonnet-5.5": TOOLS})

    async def broken() -> dict[str, ListedModel]:
        raise ReasoningError("unavailable", "offline")

    await refresh(catalogue, broken)
    assert catalogue.available() == ["utopia", "phantom", "nova", "titan", "oracle"]


def test_test_drive_answers_every_engine_with_free_models_that_can_use_tools() -> None:
    catalogue = EngineCatalogue(("anthropic/claude-haiku-5.5",), test_drive=True)
    catalogue.update(
        {
            "free/b:free": TOOLS,
            "free/a:free": SEES,
            "free/no-tools:free": NO_TOOLS,
            "anthropic/claude-opus-5.5": TOOLS,
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


def test_offers_screen_moves_only_with_models_that_can_see_and_use_tools() -> None:
    catalogue = EngineCatalogue(("quick",))
    catalogue.update({"anthropic/claude-haiku-5.5": SEES, "openai/gpt-6-luna": TOOLS, "google/gemini-2.5-flash-lite": ListedModel(tools=False, sees=True)})

    assert catalogue.seeing_models("turbo") == ("anthropic/claude-haiku-5.5",)
    assert catalogue.seeing_models("comet") == ("anthropic/claude-haiku-5.5",)
    assert catalogue.seeing_models("dove") == ()
    assert catalogue.seeing() == ["turbo", "comet", "viper"]


def test_test_drive_moves_use_free_models_that_can_see() -> None:
    catalogue = EngineCatalogue((), test_drive=True)
    catalogue.update({"free/b:free": TOOLS, "free/a:free": SEES, "free/c:free": SEES})

    assert catalogue.seeing_models("dove") == ("free/a:free", "free/c:free")
    assert catalogue.models("dove") == ("free/a:free", "free/b:free", "free/c:free")
