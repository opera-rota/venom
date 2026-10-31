from collections.abc import AsyncGenerator, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

type TurnRole = Literal["user", "assistant"]


@dataclass(frozen=True, slots=True)
class Turn:
    role: TurnRole
    text: str


@dataclass(frozen=True, slots=True)
class ModelCall:
    model: str
    system: str
    turns: Sequence[Turn]
    max_output_tokens: int
    schema: Mapping[str, object] | None


@dataclass(frozen=True, slots=True)
class TextChunk:
    text: str


@dataclass(frozen=True, slots=True)
class Thinking:
    pass


@dataclass(frozen=True, slots=True)
class Completion:
    text: str
    model: str
    stop_reason: str | None
    input_tokens: int
    output_tokens: int
    cost_micro_usd: int


type ProviderEvent = TextChunk | Thinking | Completion


class Provider(Protocol):
    def stream(self, call: ModelCall) -> AsyncGenerator[ProviderEvent]: ...
