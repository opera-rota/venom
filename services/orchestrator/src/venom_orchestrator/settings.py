import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast

from venom_reasoning.openrouter_provider import OPENROUTER_URL

type LogLevel = Literal["debug", "info", "warning", "error"]

LOG_LEVELS: frozenset[str] = frozenset({"debug", "info", "warning", "error"})


class SettingsError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class BrainSettings:
    api_key: str
    openrouter_url: str
    host: str
    port: int
    log_level: LogLevel
    understand_models: tuple[str, ...]
    test_drive: bool

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> BrainSettings:
        source = os.environ if environment is None else environment
        api_key = source.get("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise SettingsError("OPENROUTER_API_KEY is not set. Store your OpenRouter key as shown in the setup steps, then open a new terminal.")

        port_text = source.get("VENOM_BRAIN_PORT", "4200")
        if not port_text.isdigit() or not 1 <= int(port_text) <= 65_535:
            raise SettingsError(f"VENOM_BRAIN_PORT must be a port number, not {port_text!r}.")

        test_drive = source.get("VENOM_TEST_DRIVE", "").strip().lower()
        if test_drive not in {"", "0", "1", "false", "true", "off", "on"}:
            raise SettingsError("VENOM_TEST_DRIVE must be 1 (free models only) or 0 (the real engines).")

        log_level = source.get("VENOM_LOG_LEVEL", "info").lower()
        if log_level not in LOG_LEVELS:
            raise SettingsError(f"VENOM_LOG_LEVEL must be one of {', '.join(sorted(LOG_LEVELS))}.")

        return cls(
            api_key=api_key,
            openrouter_url=source.get("VENOM_OPENROUTER_URL", OPENROUTER_URL),
            host=source.get("VENOM_BRAIN_HOST", "127.0.0.1"),
            port=int(port_text),
            log_level=cast(LogLevel, log_level),
            understand_models=(
                source.get("VENOM_UNDERSTAND_MODEL", "anthropic/claude-haiku-5.5"),
                source.get("VENOM_UNDERSTAND_FALLBACK", "google/gemini-2.5-flash-lite"),
            ),
            test_drive=test_drive in {"1", "true", "on"},
        )
