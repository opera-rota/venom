import logging
import sys
from functools import partial

import uvicorn

from venom_orchestrator.engines import EngineCatalogue, keep_fresh
from venom_orchestrator.server import create_app
from venom_orchestrator.settings import BrainSettings, SettingsError
from venom_orchestrator.turns import Orchestrator
from venom_reasoning.openrouter_provider import OpenRouterProvider, create_client, listed_models
from venom_reasoning.reasoner import Reasoner


class RequestIdDefault(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RequestIdDefault())
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s", "%H:%M:%S"))
    logging.basicConfig(level=level.upper(), handlers=[handler], force=True)
    for noisy in ("httpx2", "openai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def main() -> None:
    try:
        settings = BrainSettings.from_environment()
    except SettingsError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from None

    configure_logging(settings.log_level)
    client = create_client(settings.api_key, settings.openrouter_url)
    catalogue = EngineCatalogue(settings.understand_models, test_drive=settings.test_drive)
    orchestrator = Orchestrator(Reasoner(OpenRouterProvider(client)), catalogue)
    logging.getLogger("venom.brain").info(
        "brain starting on %s:%d through %s (understanding with %s)",
        settings.host,
        settings.port,
        settings.openrouter_url,
        ", ".join(settings.understand_models),
    )
    if catalogue.test_drive:
        logging.getLogger("venom.brain").warning(
            "TEST DRIVE is on: every engine answers with OpenRouter free models. Turn it off when OpenRouter has credit.",
        )
    uvicorn.run(
        create_app(orchestrator, partial(keep_fresh, catalogue, partial(listed_models, client))),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        access_log=False,
        log_config=None,
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
