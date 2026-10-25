import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast

type LogLevel = Literal["debug", "info", "warning", "error"]

LOG_LEVELS: frozenset[str] = frozenset({"debug", "info", "warning", "error"})


class SettingsError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class BrainSettings:
    api_key: str
    host: str
    port: int
    log_level: LogLevel
    reply_model: str
    fallback_model: str
    understand_model: str

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> BrainSettings:
        source = os.environ if environment is None else environment
        api_key = source.get("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            raise SettingsError("ANTHROPIC_API_KEY is not set. Store your key as shown in the setup steps, then open a new terminal.")

        port_text = source.get("VENOM_BRAIN_PORT", "4200")
        if not port_text.isdigit() or not 1 <= int(port_text) <= 65_535:
            raise SettingsError(f"VENOM_BRAIN_PORT must be a port number, not {port_text!r}.")

        log_level = source.get("VENOM_LOG_LEVEL", "info").lower()
        if log_level not in LOG_LEVELS:
            raise SettingsError(f"VENOM_LOG_LEVEL must be one of {', '.join(sorted(LOG_LEVELS))}.")

        return cls(
            api_key=api_key,
            host=source.get("VENOM_BRAIN_HOST", "127.0.0.1"),
            port=int(port_text),
            log_level=cast(LogLevel, log_level),
            reply_model=source.get("VENOM_REPLY_MODEL", "claude-sonnet-5-5"),
            fallback_model=source.get("VENOM_FALLBACK_MODEL", "claude-haiku-5-5"),
            understand_model=source.get("VENOM_UNDERSTAND_MODEL", "claude-haiku-5-5"),
        )
