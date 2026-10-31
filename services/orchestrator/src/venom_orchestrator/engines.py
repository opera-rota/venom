import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence

from venom_contracts.engines import load_engines
from venom_contracts.models import EngineId
from venom_reasoning.errors import ReasoningError

log = logging.getLogger("venom.engines")

type Lister = Callable[[], Awaitable[Mapping[str, bool]]]

REFRESH_SECONDS = 3600.0
TEST_DRIVE_POOL = 4


class EngineCatalogue:
    def __init__(self, understand: Sequence[str], *, test_drive: bool = False) -> None:
        self._understand = tuple(understand)
        self._test_drive = test_drive
        self._listed: Mapping[str, bool] | None = None

    @property
    def test_drive(self) -> bool:
        return self._test_drive

    def update(self, listed: Mapping[str, bool]) -> None:
        self._listed = dict(listed)

    def free_models(self) -> tuple[str, ...]:
        if self._listed is None:
            return ()
        free = sorted(model for model, tools in self._listed.items() if tools and model.endswith(":free"))
        return tuple(free[:TEST_DRIVE_POOL])

    def models(self, engine: EngineId) -> tuple[str, ...]:
        if self._test_drive:
            return self.free_models()
        wanted = load_engines()[engine].models
        if self._listed is None:
            return tuple(wanted)
        return tuple(model for model in wanted if model in self._listed)

    def understand_models(self) -> tuple[str, ...]:
        if self._test_drive:
            return self.free_models()
        if self._listed is None:
            return self._understand
        return tuple(model for model in self._understand if self._listed.get(model, False))

    def available(self) -> list[EngineId]:
        return [engine for engine in load_engines() if self.models(engine)]

    def missing(self) -> list[str]:
        if self._listed is None:
            return []
        if self._test_drive:
            return []
        named = {model for engine in load_engines().values() for model in engine.models}
        return sorted(named - self._listed.keys())


async def refresh(catalogue: EngineCatalogue, lister: Lister) -> None:
    try:
        catalogue.update(await lister())
    except ReasoningError as error:
        log.warning("could not check which models OpenRouter offers (%s); keeping the last known list", error.detail)
        return
    log.info("engines ready: %d of %d available", len(catalogue.available()), len(load_engines()))
    if catalogue.test_drive:
        log.warning("TEST DRIVE: every engine answers with these free models: %s", ", ".join(catalogue.free_models()) or "none offered right now")
    if missing := catalogue.missing():
        log.warning("models not offered by OpenRouter right now: %s", ", ".join(missing))
    if not catalogue.understand_models():
        log.error("no understanding model with tool support is offered; every message will be treated as a question")


async def keep_fresh(catalogue: EngineCatalogue, lister: Lister, every: float = REFRESH_SECONDS) -> None:
    while True:
        await refresh(catalogue, lister)
        await asyncio.sleep(every)
