from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import isfinite
from typing import Protocol, cast

import openai

from venom_reasoning.errors import ReasoningError
from venom_reasoning.openrouter_provider import extra, translate


@dataclass(frozen=True, slots=True)
class Embedded:
    model: str
    vectors: list[list[float]]
    input_tokens: int
    cost_micro_usd: int


class Embedder(Protocol):
    async def embed(self, model: str, texts: Sequence[str], price_per_token: float) -> Embedded: ...


class OpenRouterEmbedder:
    def __init__(self, client: openai.AsyncOpenAI) -> None:
        self._client = client

    async def embed(self, model: str, texts: Sequence[str], price_per_token: float) -> Embedded:
        try:
            response = await self._client.embeddings.create(model=model, input=list(texts), encoding_format="float")
        except openai.APIError as error:
            raise translate(error) from error

        ordered = sorted(response.data, key=lambda item: item.index)
        vectors = [list(item.embedding) for item in ordered]
        if len(vectors) != len(texts) or any(not vector or not all(isfinite(value) for value in vector) for vector in vectors):
            raise ReasoningError("invalid_output", "The embedding model did not return one vector for every text.")
        if len({len(vector) for vector in vectors}) != 1:
            raise ReasoningError("invalid_output", "The embedding model returned vectors of different sizes.")

        tokens = response.usage.prompt_tokens
        reported = extra(response.usage).get("cost")
        cost = reported if isinstance(reported, int | float) and reported >= 0 else tokens * price_per_token
        return Embedded(model=response.model or model, vectors=vectors, input_tokens=tokens, cost_micro_usd=round(cost * 1_000_000))


async def listed_embedding_models(client: openai.AsyncOpenAI) -> dict[str, float]:
    try:
        body = await client.get("/embeddings/models", cast_to=object)
    except openai.APIError as error:
        raise translate(error) from error
    return prices(body)


def prices(body: object) -> dict[str, float]:
    if not isinstance(body, Mapping):
        raise ReasoningError("invalid_output", "OpenRouter sent a model list VENOM could not read.")
    data = cast(Mapping[str, object], body).get("data")
    if not isinstance(data, list):
        raise ReasoningError("invalid_output", "OpenRouter sent a model list VENOM could not read.")
    listed: dict[str, float] = {}
    for entry in cast(list[object], data):
        if not isinstance(entry, Mapping):
            continue
        model = cast(Mapping[str, object], entry)
        identifier = model.get("id")
        pricing = model.get("pricing")
        if not isinstance(identifier, str) or not identifier:
            continue
        prompt = cast(Mapping[str, object], pricing).get("prompt") if isinstance(pricing, Mapping) else None
        try:
            price = float(prompt) if isinstance(prompt, str | int | float) else 0.0
        except ValueError:
            price = 0.0
        listed[identifier] = price if isfinite(price) and price >= 0 else 0.0
    return listed
