import asyncio
import logging
from collections.abc import AsyncGenerator, Mapping, Sequence
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from venom_contracts.models import (
    ConversationEntry,
    Intent,
    MemoryContext,
    ReasoningDelta,
    ReasoningDone,
    ReasoningEvent,
    ReasoningFailed,
    ReasoningOutput,
    ReasoningRequest,
    StructuredOutput,
    TokenUsage,
)
from venom_contracts.prompts import get_prompt
from venom_reasoning.errors import ReasoningError
from venom_reasoning.provider import Completion, ModelCall, Provider, ProviderEvent, TextChunk, Thinking, Turn

log = logging.getLogger("venom.reasoning")

STRUCTURED: Mapping[str, type[BaseModel]] = {"Intent": Intent}


@dataclass(frozen=True, slots=True)
class Limits:
    first_output: float = 20.0
    idle: float = 30.0
    total: float = 120.0


class Reasoner:
    def __init__(self, provider: Provider, limits: Limits | None = None) -> None:
        self._provider = provider
        self._limits = limits or Limits()

    async def reason(self, request: ReasoningRequest, models: Sequence[str]) -> AsyncGenerator[ReasoningEvent]:
        prompt = get_prompt(request.role)
        if prompt.version != request.prompt_version:
            yield failed(ReasoningError("internal", "VENOM asked for a prompt version it does not have."))
            return
        if not models:
            yield failed(ReasoningError("not_configured", "No model is available for this request right now."))
            return

        shape = structured_shape(request.output)
        turns = to_turns(request.messages)
        last = ReasoningError("internal", "The model could not answer.")

        for model in models:
            call = ModelCall(
                model=model,
                system=instructions(prompt.text, request.memories, request.remembered),
                turns=turns,
                max_output_tokens=request.max_output_tokens,
                schema=None if shape is None else shape.model_json_schema(),
            )
            emitted = False
            try:
                async for event in self._attempt(call):
                    match event:
                        case TextChunk(text=text):
                            emitted = True
                            yield ReasoningDelta(type="delta", text=text)
                        case Thinking():
                            continue
                        case Completion():
                            yield done(event, shape)
                return
            except ReasoningError as error:
                last = error
            except Exception:
                log.exception("reasoning failed unexpectedly", extra={"request_id": str(request.request_id), "model": model})
                last = ReasoningError("internal", "Something unexpected went wrong while thinking.")
            log.warning(
                "model attempt failed: %s",
                last.reason,
                extra={"request_id": str(request.request_id), "model": model, "emitted": emitted},
            )
            if emitted or not last.retryable:
                break

        yield failed(last)

    async def _attempt(self, call: ModelCall) -> AsyncGenerator[ProviderEvent]:
        stream = self._provider.stream(call)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._limits.total
        wait = self._limits.first_output
        try:
            while True:
                remaining = deadline - loop.time()
                try:
                    event = await asyncio.wait_for(anext(stream), timeout=max(0.0, min(wait, remaining)))
                except StopAsyncIteration:
                    raise ReasoningError("invalid_output", "The model stopped without finishing its answer.") from None
                except TimeoutError:
                    raise ReasoningError("timeout", "The model took too long to answer.") from None
                wait = self._limits.idle
                yield event
                if isinstance(event, Completion):
                    return
        finally:
            await stream.aclose()


def structured_shape(output: ReasoningOutput) -> type[BaseModel] | None:
    match output:
        case StructuredOutput(contract=contract):
            return STRUCTURED[contract]
        case _:
            return None


def done(completion: Completion, shape: type[BaseModel] | None) -> ReasoningDone:
    text = completion.text
    if shape is None:
        if not text.strip():
            raise ReasoningError("invalid_output", "The model returned an empty answer.")
    else:
        try:
            text = shape.model_validate_json(text).model_dump_json()
        except ValidationError:
            raise ReasoningError("invalid_output", "The model did not answer in the required shape.") from None
    return ReasoningDone(
        type="done",
        text=text,
        model=completion.model,
        stop_reason=completion.stop_reason,
        usage=TokenUsage(
            input_tokens=completion.input_tokens,
            output_tokens=completion.output_tokens,
            cost_micro_usd=completion.cost_micro_usd,
        ),
    )


def failed(error: ReasoningError) -> ReasoningFailed:
    return ReasoningFailed(type="failed", reason=error.reason, detail=error.detail)


def instructions(rules: str, memories: Sequence[MemoryContext], remembered: MemoryContext | None) -> str:
    sections = [rules]
    if memories:
        sections.append("Remembered:\n" + "\n".join(listed(memory) for memory in memories))
    if remembered is not None:
        sections.append("Just saved:\n" + listed(remembered))
    return "\n\n".join(sections)


def listed(memory: MemoryContext) -> str:
    return f"- ({memory.type}, saved {memory.saved_at.date().isoformat()}) {memory.content}"


def to_turns(entries: Sequence[ConversationEntry]) -> list[Turn]:
    turns: list[Turn] = []
    for entry in entries:
        role = "user" if entry.speaker == "user" else "assistant"
        if not turns and role == "assistant":
            continue
        if turns and turns[-1].role == role:
            turns[-1] = Turn(role, f"{turns[-1].text}\n\n{entry.text}")
        else:
            turns.append(Turn(role, entry.text))
    return turns
