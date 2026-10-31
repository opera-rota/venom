import json
from collections.abc import Callable

import httpx2
import openai
import pytest

from venom_reasoning.embeddings import OpenRouterEmbedder, listed_embedding_models, prices
from venom_reasoning.errors import ReasoningError
from venom_reasoning.openrouter_provider import ATTRIBUTION

pytestmark = pytest.mark.anyio

type Handler = Callable[[httpx2.Request], httpx2.Response]

MODEL = "openai/text-embedding-3-small"


def client(handler: Handler, seen: list[httpx2.Request]) -> openai.AsyncOpenAI:
    def record(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return handler(request)

    return openai.AsyncOpenAI(
        api_key="sk-or-test",
        base_url="https://openrouter.test/api/v1",
        default_headers=ATTRIBUTION,
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(record)),
    )


def embedded(*vectors: list[float], usage: dict[str, object] | None = None) -> Handler:
    body = {
        "object": "list",
        "model": MODEL,
        "data": [{"object": "embedding", "index": index, "embedding": vector} for index, vector in reversed(list(enumerate(vectors)))],
        "usage": usage or {"prompt_tokens": 9, "total_tokens": 9, "cost": 0.00000018},
    }
    return lambda _request: httpx2.Response(200, json=body)


async def test_embeds_texts_in_order_and_reads_the_cost() -> None:
    seen: list[httpx2.Request] = []
    embedder = OpenRouterEmbedder(client(embedded([0.1, 0.2], [0.3, 0.4]), seen))
    result = await embedder.embed(MODEL, ["first", "second"], 0.00000002)

    assert result.vectors == [[0.1, 0.2], [0.3, 0.4]]
    assert (result.model, result.input_tokens, result.cost_micro_usd) == (MODEL, 9, 0)
    sent = json.loads(seen[0].content)
    assert sent == {"model": MODEL, "input": ["first", "second"], "encoding_format": "float"}
    assert seen[0].url.path == "/api/v1/embeddings"


async def test_counts_the_cost_from_the_listed_price_when_none_is_reported() -> None:
    usage: dict[str, object] = {"prompt_tokens": 50_000, "total_tokens": 50_000}
    embedder = OpenRouterEmbedder(client(embedded([0.5], usage=usage), []))
    result = await embedder.embed(MODEL, ["a long text"], 0.00000002)
    assert result.cost_micro_usd == 1000


async def test_refuses_a_missing_vector() -> None:
    embedder = OpenRouterEmbedder(client(embedded([0.1, 0.2]), []))
    with pytest.raises(ReasoningError) as raised:
        await embedder.embed(MODEL, ["first", "second"], 0.0)
    assert raised.value.reason == "invalid_output"


async def test_explains_running_out_of_credit() -> None:
    def broke(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(402, json={"error": {"code": 402, "message": "Insufficient credits"}})

    with pytest.raises(ReasoningError) as raised:
        await OpenRouterEmbedder(client(broke, [])).embed(MODEL, ["text"], 0.0)
    assert raised.value.reason == "refused"
    assert "run out of credit" in raised.value.detail


async def test_lists_embedding_models_with_their_price() -> None:
    listing = {
        "data": [
            {"id": MODEL, "pricing": {"prompt": "0.00000002", "completion": "0"}},
            {"id": "liquid/lfm-2.5-embedding-350m:free", "pricing": {"prompt": "0", "completion": "0"}},
        ]
    }
    seen: list[httpx2.Request] = []
    listed = await listed_embedding_models(client(lambda _request: httpx2.Response(200, json=listing), seen))

    assert listed == {MODEL: 0.00000002, "liquid/lfm-2.5-embedding-350m:free": 0.0}
    assert seen[0].url.path == "/api/v1/embeddings/models"


def test_skips_unreadable_entries_in_the_model_list() -> None:
    unreadable: dict[str, object] = {"data": [{"id": "good", "pricing": {"prompt": "nope"}}, {"pricing": {}}, "junk"]}
    assert prices(unreadable) == {"good": 0.0}
    with pytest.raises(ReasoningError):
        prices({"models": []})
