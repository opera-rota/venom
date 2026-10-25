import logging
from collections.abc import AsyncGenerator, Sequence
from contextlib import aclosing
from time import perf_counter

from venom_contracts.models import (
    ConversationEntry,
    Intent,
    IntentKind,
    PromptRole,
    ReasoningDelta,
    ReasoningDone,
    ReasoningFailed,
    ReasoningOutput,
    ReasoningRequest,
    StructuredOutput,
    TextOutput,
    TurnDelta,
    TurnDone,
    TurnEvent,
    TurnFailed,
    TurnRequest,
)
from venom_contracts.prompts import get_prompt
from venom_reasoning.reasoner import Reasoner

log = logging.getLogger("venom.orchestrator")

UNDERSTANDING_CONTEXT = 6
HISTORY_CHARACTERS = 24_000
ANSWER_TOKENS = 3000
ANSWER_CHARACTERS = 16_000
CUT_NOTICE = "\n\n*The answer was cut here because it reached the length limit.*"
TASK_REPLY = (
    "That sounds like something you want me to do, not just answer. "
    "I can't act on your devices yet, so I haven't changed anything. "
    "If you like, I can explain how to do it yourself."
)


class Orchestrator:
    def __init__(self, reasoner: Reasoner) -> None:
        self._reasoner = reasoner

    async def run(self, turn: TurnRequest) -> AsyncGenerator[TurnEvent]:
        started = perf_counter()
        context = {"request_id": str(turn.request_id)}
        history = recent(turn.history, HISTORY_CHARACTERS)
        intent = await self._understand(turn, history)
        log.info("understood the message as a %s", intent, extra=context)

        if intent == "task":
            yield TurnDelta(type="delta", text=TASK_REPLY)
            yield TurnDone(type="done", intent="task", text=TASK_REPLY, model=None)
            return

        request = self._request(turn, "reply", [*history, current(turn)], TextOutput(kind="text"), ANSWER_TOKENS)
        async with aclosing(self._reasoner.reason(request)) as events:
            async for event in events:
                match event:
                    case ReasoningDelta(text=text):
                        yield TurnDelta(type="delta", text=text)
                    case ReasoningDone(text=text, model=model, usage=usage):
                        log.info(
                            "answered with %s in %.1fs (%d tokens in, %d out)",
                            model,
                            perf_counter() - started,
                            usage.input_tokens,
                            usage.output_tokens,
                            extra=context,
                        )
                        yield TurnDone(type="done", intent="question", text=fit(text), model=model)
                    case ReasoningFailed(reason=reason, detail=detail):
                        log.warning("could not answer: %s", reason, extra=context)
                        yield TurnFailed(type="failed", reason=reason, detail=detail)

    async def _understand(self, turn: TurnRequest, history: Sequence[ConversationEntry]) -> IntentKind:
        messages = [*history[-UNDERSTANDING_CONTEXT:], current(turn)]
        request = self._request(turn, "understand", messages, StructuredOutput(kind="structured", contract="Intent"), 64)
        async with aclosing(self._reasoner.reason(request)) as events:
            async for event in events:
                match event:
                    case ReasoningDone(text=text):
                        return Intent.model_validate_json(text).kind
                    case ReasoningFailed(reason=reason):
                        log.warning("understanding failed (%s), answering as a question", reason, extra={"request_id": str(turn.request_id)})
                        return "question"
                    case ReasoningDelta():
                        continue
        return "question"

    @staticmethod
    def _request(
        turn: TurnRequest,
        role: PromptRole,
        messages: list[ConversationEntry],
        output: ReasoningOutput,
        max_output_tokens: int,
    ) -> ReasoningRequest:
        return ReasoningRequest(
            request_id=turn.request_id,
            role=role,
            prompt_version=get_prompt(role).version,
            messages=messages,
            output=output,
            max_output_tokens=max_output_tokens,
        )


def current(turn: TurnRequest) -> ConversationEntry:
    return ConversationEntry(speaker="user", text=turn.text)


def recent(history: Sequence[ConversationEntry], budget: int) -> list[ConversationEntry]:
    kept: list[ConversationEntry] = []
    used = 0
    for entry in reversed(history):
        used += len(entry.text)
        if used > budget:
            break
        kept.append(entry)
    kept.reverse()
    return kept


def fit(text: str) -> str:
    if len(text) <= ANSWER_CHARACTERS:
        return text
    return text[: ANSWER_CHARACTERS - len(CUT_NOTICE)].rstrip() + CUT_NOTICE
