import asyncio
from collections.abc import AsyncGenerator, Mapping, Sequence
from dataclasses import dataclass

from venom_reasoning.errors import ReasoningError
from venom_reasoning.provider import Completion, ModelCall, ProviderEvent, TextChunk, Thinking


@dataclass(frozen=True, slots=True)
class Pause:
    seconds: float


type Step = TextChunk | Thinking | Completion | Pause | ReasoningError


def answer(text: str, model: str, *, chunk: int = 8, cost_micro_usd: int = 2500) -> list[Step]:
    pieces: list[Step] = [TextChunk(text[start : start + chunk]) for start in range(0, len(text), chunk)]
    pieces.append(
        Completion(
            text=text,
            model=model,
            stop_reason="stop",
            input_tokens=12,
            output_tokens=len(text) // 4,
            cost_micro_usd=cost_micro_usd,
        )
    )
    return pieces


def structured(json_text: str, model: str, *, cost_micro_usd: int = 40) -> list[Step]:
    return [
        Completion(
            text=json_text,
            model=model,
            stop_reason="tool_calls",
            input_tokens=40,
            output_tokens=6,
            cost_micro_usd=cost_micro_usd,
        )
    ]


class ScriptedProvider:
    def __init__(self, scripts: Mapping[str, Sequence[Sequence[Step]]]) -> None:
        self._scripts = {model: list(attempts) for model, attempts in scripts.items()}
        self.calls: list[ModelCall] = []
        self.closed = 0

    async def stream(self, call: ModelCall) -> AsyncGenerator[ProviderEvent]:
        self.calls.append(call)
        attempts = self._scripts.get(call.model, [])
        if not attempts:
            raise ReasoningError("unavailable", f"No scripted answer for {call.model}.")
        steps = attempts.pop(0)
        try:
            for step in steps:
                match step:
                    case Pause(seconds=seconds):
                        await asyncio.sleep(seconds)
                    case ReasoningError():
                        raise step
                    case TextChunk() | Thinking() | Completion():
                        yield step
        finally:
            self.closed += 1
