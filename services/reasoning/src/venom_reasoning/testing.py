import asyncio
from collections.abc import AsyncGenerator, Mapping, Sequence
from dataclasses import dataclass

from venom_reasoning.errors import ReasoningError
from venom_reasoning.provider import Completion, ModelCall, ProviderEvent, TextChunk


@dataclass(frozen=True, slots=True)
class Pause:
    seconds: float


type Step = TextChunk | Completion | Pause | ReasoningError


def answer(text: str, model: str, *, chunk: int = 8) -> list[Step]:
    pieces: list[Step] = [TextChunk(text[start : start + chunk]) for start in range(0, len(text), chunk)]
    pieces.append(Completion(text=text, model=model, stop_reason="end_turn", input_tokens=12, output_tokens=len(text) // 4))
    return pieces


def structured(json_text: str, model: str) -> list[Step]:
    return [Completion(text=json_text, model=model, stop_reason="tool_use", input_tokens=40, output_tokens=6)]


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
                    case TextChunk() | Completion():
                        yield step
        finally:
            self.closed += 1
