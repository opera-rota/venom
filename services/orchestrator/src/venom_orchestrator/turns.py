import logging
from collections.abc import AsyncGenerator, Sequence
from contextlib import aclosing
from time import perf_counter

from venom_contracts.engines import get_engine
from venom_contracts.models import (
    ConversationEntry,
    Intent,
    IntentKind,
    MemoryContext,
    PromptRole,
    ReasoningDelta,
    ReasoningDone,
    ReasoningFailed,
    ReasoningOutput,
    ReasoningRequest,
    StructuredOutput,
    TextOutput,
    TokenUsage,
    TurnDelta,
    TurnDone,
    TurnEvent,
    TurnFailed,
    TurnRequest,
)
from venom_contracts.prompts import get_prompt
from venom_orchestrator.engines import EngineCatalogue
from venom_reasoning.reasoner import Reasoner

log = logging.getLogger("venom.orchestrator")

UNDERSTANDING_CONTEXT = 6
HISTORY_CHARACTERS = 24_000
ANSWER_TOKENS = 3000
UNDERSTAND_TOKENS = 512
ANSWER_CHARACTERS = 16_000
CUT_NOTICE = "\n\n*The answer was cut here because it reached the length limit.*"
TASK_REPLY = (
    "That sounds like something you want me to do, not just answer. "
    "I can't act on your devices yet, so I haven't changed anything. "
    "If you like, I can explain how to do it yourself."
)
NOTHING_USED = TokenUsage(input_tokens=0, output_tokens=0, cost_micro_usd=0)


class Orchestrator:
    def __init__(self, reasoner: Reasoner, catalogue: EngineCatalogue) -> None:
        self._reasoner = reasoner
        self._catalogue = catalogue

    @property
    def catalogue(self) -> EngineCatalogue:
        return self._catalogue

    async def run(self, turn: TurnRequest) -> AsyncGenerator[TurnEvent]:
        started = perf_counter()
        context = {"request_id": str(turn.request_id)}
        engine = get_engine(turn.engine)
        models = self._catalogue.models(turn.engine)
        if not models:
            log.warning("engine %s has no model available", engine.id, extra=context)
            yield TurnFailed(type="failed", reason="not_configured", detail=f"{engine.name} is not available right now. Choose another engine.")
            return

        history = recent(turn.history, HISTORY_CHARACTERS)
        if turn.remembered is None:
            intent, understood = await self._understand(turn, history)
            log.info("understood the message as a %s", intent, extra=context)
        else:
            intent, understood = "question", NOTHING_USED
            log.info("the message asked me to remember something; answering with what was saved", extra=context)

        if intent == "task":
            yield TurnDelta(type="delta", text=TASK_REPLY)
            yield TurnDone(type="done", intent="task", text=TASK_REPLY, model=None, usage=understood)
            return

        request = self._request(
            turn,
            "reply",
            [*history, current(turn)],
            TextOutput(kind="text"),
            ANSWER_TOKENS,
            memories=turn.memories,
            remembered=turn.remembered,
        )
        async with aclosing(self._reasoner.reason(request, models)) as events:
            async for event in events:
                match event:
                    case ReasoningDelta(text=text):
                        yield TurnDelta(type="delta", text=text)
                    case ReasoningDone(text=text, model=model, usage=usage):
                        total = combined(understood, usage)
                        log.info(
                            "%s answered with %s in %.1fs (%d tokens in, %d out, %d micro-dollars)",
                            engine.name,
                            model,
                            perf_counter() - started,
                            total.input_tokens,
                            total.output_tokens,
                            total.cost_micro_usd,
                            extra=context,
                        )
                        yield TurnDone(type="done", intent="question", text=fit(text), model=model, usage=total)
                    case ReasoningFailed(reason=reason, detail=detail):
                        log.warning("could not answer: %s", reason, extra=context)
                        yield TurnFailed(type="failed", reason=reason, detail=detail)

    async def _understand(self, turn: TurnRequest, history: Sequence[ConversationEntry]) -> tuple[IntentKind, TokenUsage]:
        messages = [*history[-UNDERSTANDING_CONTEXT:], current(turn)]
        request = self._request(turn, "understand", messages, StructuredOutput(kind="structured", contract="Intent"), UNDERSTAND_TOKENS)
        async with aclosing(self._reasoner.reason(request, self._catalogue.understand_models())) as events:
            async for event in events:
                match event:
                    case ReasoningDone(text=text, usage=usage):
                        return Intent.model_validate_json(text).kind, usage
                    case ReasoningFailed(reason=reason):
                        log.warning("understanding failed (%s), answering as a question", reason, extra={"request_id": str(turn.request_id)})
                        return "question", NOTHING_USED
                    case ReasoningDelta():
                        continue
        return "question", NOTHING_USED

    @staticmethod
    def _request(
        turn: TurnRequest,
        role: PromptRole,
        messages: list[ConversationEntry],
        output: ReasoningOutput,
        max_output_tokens: int,
        *,
        memories: Sequence[MemoryContext] = (),
        remembered: MemoryContext | None = None,
    ) -> ReasoningRequest:
        return ReasoningRequest(
            request_id=turn.request_id,
            role=role,
            prompt_version=get_prompt(role).version,
            messages=messages,
            memories=list(memories),
            remembered=remembered,
            output=output,
            max_output_tokens=max_output_tokens,
        )


def current(turn: TurnRequest) -> ConversationEntry:
    return ConversationEntry(speaker="user", text=turn.text)


def combined(first: TokenUsage, second: TokenUsage) -> TokenUsage:
    return TokenUsage(
        input_tokens=first.input_tokens + second.input_tokens,
        output_tokens=first.output_tokens + second.output_tokens,
        cost_micro_usd=first.cost_micro_usd + second.cost_micro_usd,
    )


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
