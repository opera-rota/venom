import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping

from venom_contracts.models import EmbeddingRequest, Embeddings, TokenUsage
from venom_reasoning.embeddings import Embedder
from venom_reasoning.errors import ReasoningError

log = logging.getLogger("venom.embedding")

type PriceLister = Callable[[], Awaitable[Mapping[str, float]]]

REFRESH_SECONDS = 3600.0
EMBED_SECONDS = 15.0


class EmbeddingCatalogue:
    def __init__(self, model: str, *, test_drive: bool = False) -> None:
        self._model = model
        self._test_drive = test_drive
        self._listed: Mapping[str, float] | None = None

    @property
    def test_drive(self) -> bool:
        return self._test_drive

    def update(self, listed: Mapping[str, float]) -> None:
        self._listed = dict(listed)

    def current(self) -> str | None:
        if self._test_drive:
            if self._listed is None:
                return None
            free = sorted(model for model in self._listed if model.endswith(":free"))
            return free[0] if free else None
        if self._listed is None or self._model in self._listed:
            return self._model
        return None

    def price(self, model: str) -> float:
        return 0.0 if self._listed is None else self._listed.get(model, 0.0)


class EmbeddingService:
    def __init__(self, embedder: Embedder, catalogue: EmbeddingCatalogue, timeout: float = EMBED_SECONDS) -> None:
        self._embedder = embedder
        self._catalogue = catalogue
        self._timeout = timeout

    @property
    def catalogue(self) -> EmbeddingCatalogue:
        return self._catalogue

    async def embed(self, request: EmbeddingRequest) -> Embeddings:
        model = self._catalogue.current()
        if model is None:
            raise ReasoningError("not_configured", "No embedding model is offered right now.")
        try:
            result = await asyncio.wait_for(self._embedder.embed(model, request.texts, self._catalogue.price(model)), timeout=self._timeout)
        except TimeoutError:
            raise ReasoningError("timeout", "The embedding model took too long to answer.") from None
        log.info(
            "embedded %d text(s) with %s (%d tokens, %d micro-dollars)",
            len(request.texts),
            model,
            result.input_tokens,
            result.cost_micro_usd,
            extra={"request_id": str(request.request_id)},
        )
        return Embeddings(
            model=model,
            vectors=result.vectors,
            usage=TokenUsage(input_tokens=result.input_tokens, output_tokens=0, cost_micro_usd=result.cost_micro_usd),
        )


async def refresh_embeddings(catalogue: EmbeddingCatalogue, lister: PriceLister) -> None:
    try:
        catalogue.update(await lister())
    except ReasoningError as error:
        log.warning("could not check which embedding models OpenRouter offers (%s); keeping the last known list", error.detail)
        return
    model = catalogue.current()
    if model is None:
        log.error("no embedding model is offered right now; memory will be found by its words only")
    elif catalogue.test_drive:
        log.warning("TEST DRIVE: memory is embedded with the free model %s", model)
    else:
        log.info("memory is embedded with %s", model)


async def keep_embeddings_fresh(catalogue: EmbeddingCatalogue, lister: PriceLister, every: float = REFRESH_SECONDS) -> None:
    while True:
        await refresh_embeddings(catalogue, lister)
        await asyncio.sleep(every)
