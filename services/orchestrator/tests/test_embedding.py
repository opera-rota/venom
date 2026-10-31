import pytest

from venom_contracts.models import EmbeddingRequest
from venom_orchestrator.embedding import EmbeddingCatalogue, EmbeddingService, refresh_embeddings
from venom_reasoning.errors import ReasoningError
from venom_reasoning.testing import FixedEmbedder

pytestmark = pytest.mark.anyio

ASK = EmbeddingRequest.model_validate({"request_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01", "texts": ["I prefer tea"]})


def test_uses_the_configured_model_until_the_list_is_known() -> None:
    catalogue = EmbeddingCatalogue("openai/text-embedding-3-small")
    assert catalogue.current() == "openai/text-embedding-3-small"
    catalogue.update({"qwen/qwen3-embedding-8b": 0.00000001})
    assert catalogue.current() is None


def test_test_drive_picks_a_free_embedding_model_from_the_live_list() -> None:
    catalogue = EmbeddingCatalogue("openai/text-embedding-3-small", test_drive=True)
    assert catalogue.current() is None
    catalogue.update({"openai/text-embedding-3-small": 0.00000002, "nvidia/embed-b:free": 0.0, "liquid/embed-a:free": 0.0})
    assert catalogue.current() == "liquid/embed-a:free"
    assert catalogue.price("openai/text-embedding-3-small") == 0.00000002


async def test_keeps_the_last_known_list_when_the_check_fails() -> None:
    catalogue = EmbeddingCatalogue("openai/text-embedding-3-small")
    catalogue.update({"openai/text-embedding-3-small": 0.00000002})

    async def broken() -> dict[str, float]:
        raise ReasoningError("unavailable", "offline")

    await refresh_embeddings(catalogue, broken)
    assert catalogue.current() == "openai/text-embedding-3-small"


async def test_reports_what_the_embedding_cost() -> None:
    service = EmbeddingService(FixedEmbedder(cost_micro_usd=2), EmbeddingCatalogue("openai/text-embedding-3-small"))
    result = await service.embed(ASK)
    assert (result.model, result.usage.input_tokens, result.usage.cost_micro_usd) == ("openai/text-embedding-3-small", 3, 2)


async def test_gives_up_cleanly_when_the_model_hangs() -> None:
    service = EmbeddingService(FixedEmbedder(pause=1.0), EmbeddingCatalogue("openai/text-embedding-3-small"), timeout=0.05)
    with pytest.raises(ReasoningError) as raised:
        await service.embed(ASK)
    assert raised.value.reason == "timeout"
