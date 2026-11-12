import logging
from collections.abc import AsyncGenerator, Sequence
from contextlib import aclosing
from time import perf_counter

from venom_contracts.engines import get_engine
from venom_contracts.models import (
    ConnectorService,
    ConversationEntry,
    Intent,
    IntentKind,
    MemoryContext,
    PlanDraft,
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
PLAN_TOKENS = 4000
ANSWER_CHARACTERS = 16_000
CUT_NOTICE = "\n\n*The answer was cut here because it reached the length limit.*"
BROKEN_PLAN = (
    "I tried to plan that, but my plan came back broken, so I threw it away. "
    "Nothing was done. Try again, or say it a little differently."
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
            understanding = await self._understand(turn, history)
            if isinstance(understanding, ReasoningFailed):
                log.warning("could not understand the message (%s), so nothing was done", understanding.reason, extra=context)
                yield TurnFailed(type="failed", reason=understanding.reason, detail=not_understood(understanding.detail))
                return
            intent, understood = understanding
            log.info("understood the message as a %s", intent, extra=context)
        else:
            intent, understood = "question", NOTHING_USED
            log.info("the message asked me to remember something; answering with what was saved", extra=context)

        if intent == "task" and turn.task_mode == "loop":
            log.info("handing the task to the look, think, act loop", extra=context)
            yield TurnDone(type="done", intent="task", text=fit(turn.text), plan=None, model=None, usage=understood)
            return

        if intent == "task":
            async for event in self._plan(turn, history, models, understood):
                yield event
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
                        yield TurnDone(type="done", intent="question", text=fit(text), plan=None, model=model, usage=total)
                    case ReasoningFailed(reason=reason, detail=detail):
                        log.warning("could not answer: %s", reason, extra=context)
                        yield TurnFailed(type="failed", reason=reason, detail=detail)

    async def _plan(
        self,
        turn: TurnRequest,
        history: Sequence[ConversationEntry],
        models: Sequence[str],
        understood: TokenUsage,
    ) -> AsyncGenerator[TurnEvent]:
        context = {"request_id": str(turn.request_id)}
        request = self._request(
            turn,
            "plan",
            [*history[-UNDERSTANDING_CONTEXT:], current(turn)],
            StructuredOutput(kind="structured", contract="PlanDraft"),
            PLAN_TOKENS,
            memories=turn.memories,
            connectors=turn.connectors,
        )
        async with aclosing(self._reasoner.reason(request, models)) as events:
            async for event in events:
                match event:
                    case ReasoningDone(text=text, model=model, usage=usage):
                        plan = PlanDraft.model_validate_json(text)
                        log.info("planned %d steps with %s", len(plan.steps), model, extra=context)
                        yield TurnDone(type="done", intent="task", text=plan.cannot or plan.title, plan=plan, model=model, usage=combined(understood, usage))
                    case ReasoningFailed(reason="invalid_output"):
                        log.warning("the plan came back broken and was thrown away", extra=context)
                        yield TurnDone(type="done", intent="task", text=BROKEN_PLAN, plan=None, model=None, usage=understood)
                    case ReasoningFailed(reason=reason, detail=detail):
                        log.warning("could not plan: %s", reason, extra=context)
                        yield TurnFailed(type="failed", reason=reason, detail=detail)
                    case ReasoningDelta():
                        continue

    async def _understand(self, turn: TurnRequest, history: Sequence[ConversationEntry]) -> tuple[IntentKind, TokenUsage] | ReasoningFailed:
        messages = [*history[-UNDERSTANDING_CONTEXT:], current(turn)]
        request = self._request(turn, "understand", messages, StructuredOutput(kind="structured", contract="Intent"), UNDERSTAND_TOKENS)
        async with aclosing(self._reasoner.reason(request, self._catalogue.understand_models())) as events:
            async for event in events:
                match event:
                    case ReasoningDone(text=text, usage=usage):
                        return Intent.model_validate_json(text).kind, usage
                    case ReasoningFailed():
                        return event
                    case ReasoningDelta():
                        continue
        return ReasoningFailed(type="failed", reason="internal", detail="The understanding stage ended without a result.")

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
        connectors: Sequence[ConnectorService] | None = None,
    ) -> ReasoningRequest:
        return ReasoningRequest(
            request_id=turn.request_id,
            role=role,
            prompt_version=get_prompt(role).version,
            messages=messages,
            memories=list(memories),
            remembered=remembered,
            connectors=None if connectors is None else list(connectors),
            picture=None,
            output=output,
            max_output_tokens=max_output_tokens,
        )


def not_understood(reason: str) -> str:
    return f"I could not tell whether you wanted an answer or wanted something done, so I did nothing. {reason} Try again in a minute."


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
