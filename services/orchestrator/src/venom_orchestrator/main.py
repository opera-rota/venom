import logging
import sys

import anthropic
import uvicorn

from venom_orchestrator.server import create_app
from venom_orchestrator.settings import BrainSettings, SettingsError
from venom_orchestrator.turns import Orchestrator
from venom_reasoning.anthropic_provider import AnthropicProvider
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
    logging.getLogger("httpx2").setLevel(logging.WARNING)


def main() -> None:
    try:
        settings = BrainSettings.from_environment()
    except SettingsError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from None

    configure_logging(settings.log_level)
    client = anthropic.AsyncAnthropic(
        api_key=settings.api_key,
        max_retries=1,
        timeout=anthropic.Timeout(120.0, connect=10.0),
    )
    reasoner = Reasoner(
        AnthropicProvider(client),
        {
            "understand": (settings.understand_model,),
            "reply": (settings.reply_model, settings.fallback_model),
        },
    )
    logging.getLogger("venom.brain").info(
        "brain starting on %s:%d (reply %s, fallback %s, understand %s)",
        settings.host,
        settings.port,
        settings.reply_model,
        settings.fallback_model,
        settings.understand_model,
    )
    uvicorn.run(
        create_app(Orchestrator(reasoner)),
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        access_log=False,
        log_config=None,
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
