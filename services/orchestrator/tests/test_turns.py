from datetime import UTC, datetime
from uuid import UUID

import pytest

from venom_contracts.engines import get_engine
from venom_contracts.models import (
    ConversationEntry,
    DraftStep,
    EngineId,
    MemoryContext,
    OpenAppAction,
    PlanDraft,
    TurnDelta,
    TurnDone,
    TurnEvent,
    TurnFailed,
    TurnRequest,
    TypeTextAction,
)
from venom_orchestrator.engines import EngineCatalogue
from venom_orchestrator.turns import ANSWER_CHARACTERS, BROKEN_PLAN, Orchestrator, fit, recent
from venom_reasoning.errors import ReasoningError
from venom_reasoning.openrouter_provider import ListedModel
from venom_reasoning.reasoner import Limits, Reasoner
from venom_reasoning.testing import ScriptedProvider, Step, answer, structured

pytestmark = pytest.mark.anyio

PRIMARY, FALLBACK = get_engine("titan").models[:2]


def turn(
    text: str,
    history: list[ConversationEntry] | None = None,
    engine: EngineId = "titan",
    *,
    memories: list[MemoryContext] | None = None,
    remembered: MemoryContext | None = None,
) -> TurnRequest:
    return TurnRequest(
        request_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01"),
        account_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02"),
        device_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03"),
        engine=engine,
        history=history or [],
        memories=memories or [],
        remembered=remembered,
        connectors=[],
        text=text,
    )


async def run(provider: ScriptedProvider, request: TurnRequest, catalogue: EngineCatalogue | None = None) -> list[TurnEvent]:
    reasoner = Reasoner(provider, Limits(first_output=0.5, idle=0.5, total=2.0))
    orchestrator = Orchestrator(reasoner, catalogue or EngineCatalogue(("quick",)))
    return [event async for event in orchestrator.run(request)]


def question() -> list[Step]:
    return structured('{"kind": "question"}', "quick")


def task(cost_micro_usd: int = 40) -> list[Step]:
    return structured('{"kind": "task"}', "quick", cost_micro_usd=cost_micro_usd)


NOTEPAD_PLAN = PlanDraft(
    title="Shopping list in Notepad",
    steps=[
        DraftStep(summary="Open Notepad", spec=OpenAppAction(name="open_app", app="Notepad", open=None), effects=[], reversible=True),
        DraftStep(
            summary="Type the shopping list",
            spec=TypeTextAction(name="type_text", text="Milk, bread, eggs", into="the Notepad window"),
            effects=[],
            reversible=True,
        ),
    ],
    cannot=None,
)


async def test_answers_a_question_as_a_stream() -> None:
    provider = ScriptedProvider({"quick": [question()], PRIMARY: [answer("A mutex is a lock for shared data.", PRIMARY)]})
    events = await run(provider, turn("Explain what a mutex is"))

    assert "".join(event.text for event in events if isinstance(event, TurnDelta)) == "A mutex is a lock for shared data."
    final = events[-1]
    assert isinstance(final, TurnDone)
    assert (final.intent, final.model, final.text) == ("question", PRIMARY, "A mutex is a lock for shared data.")
    assert [call.model for call in provider.calls] == ["quick", PRIMARY]


async def test_sends_the_conversation_so_far() -> None:
    history = [
        ConversationEntry(speaker="user", text="What is a thread?"),
        ConversationEntry(speaker="venom", text="One path of execution."),
    ]
    provider = ScriptedProvider({"quick": [question()], PRIMARY: [answer("Yes, threads share memory.", PRIMARY)]})
    await run(provider, turn("Do they share memory?", history))

    reply = provider.calls[1]
    assert [(entry.role, entry.text) for entry in reply.turns] == [
        ("user", "What is a thread?"),
        ("assistant", "One path of execution."),
        ("user", "Do they share memory?"),
    ]


async def test_plans_a_task_without_doing_anything() -> None:
    provider = ScriptedProvider({"quick": [task()], PRIMARY: [structured(NOTEPAD_PLAN.model_dump_json(), PRIMARY)]})
    events = await run(provider, turn("Open Notepad and write my shopping list"))

    final = events[-1]
    assert isinstance(final, TurnDone)
    assert (final.intent, final.plan, final.model, final.text) == ("task", NOTEPAD_PLAN, PRIMARY, "Shopping list in Notepad")
    assert not any(isinstance(event, TurnDelta) for event in events)
    plan_call = provider.calls[1]
    assert plan_call.model == PRIMARY
    assert plan_call.system.endswith("Connected services:\nnone")
    assert plan_call.schema is not None
    properties = plan_call.schema["properties"]
    assert isinstance(properties, dict) and "steps" in properties


async def test_says_plainly_when_a_task_cannot_be_planned() -> None:
    cannot = PlanDraft(title="Book a flight", steps=[], cannot="Booking a flight needs a payment I cannot make for you yet.")
    provider = ScriptedProvider({"quick": [task()], PRIMARY: [structured(cannot.model_dump_json(), PRIMARY)]})
    final = (await run(provider, turn("Book me a flight to Nairobi")))[-1]

    assert isinstance(final, TurnDone)
    assert (final.text, final.plan) == ("Booking a flight needs a payment I cannot make for you yet.", cannot)


async def test_throws_away_a_broken_plan_and_says_nothing_was_done() -> None:
    broken = structured('{"title": "Clean up", "steps": [{"summary": "Delete files", "spec": {"name": "shell", "command": "rm -rf ~"}}]}', PRIMARY)
    provider = ScriptedProvider({"quick": [task(cost_micro_usd=55)], PRIMARY: [broken] * 2, FALLBACK: [structured("not json at all", FALLBACK)] * 2})
    final = (await run(provider, turn("Clean up my computer")))[-1]

    assert isinstance(final, TurnDone)
    assert (final.intent, final.text, final.plan, final.model) == ("task", BROKEN_PLAN, None, None)
    assert final.usage.cost_micro_usd == 55
    assert [call.model for call in provider.calls] == ["quick", PRIMARY, PRIMARY, FALLBACK, FALLBACK]


async def test_reports_a_planner_that_cannot_be_reached() -> None:
    down: list[Step] = [ReasoningError("rate_limited", "Too many requests right now.")]
    provider = ScriptedProvider({"quick": [task()], PRIMARY: [down], FALLBACK: [down]})
    final = (await run(provider, turn("Open Notepad")))[-1]

    assert isinstance(final, TurnFailed)
    assert (final.reason, final.detail) == ("rate_limited", "Too many requests right now.")


async def test_does_nothing_and_says_so_when_understanding_fails() -> None:
    busy: list[Step] = [ReasoningError("rate_limited", "The model service is busy right now.")]
    provider = ScriptedProvider({"quick": [busy], PRIMARY: [answer("How to do it yourself.", PRIMARY)]})
    events = await run(provider, turn("Delete old-list.txt, then open Notepad"))

    assert len(events) == 1
    final = events[0]
    assert isinstance(final, TurnFailed)
    assert final.reason == "rate_limited"
    assert final.detail == (
        "I could not tell whether you wanted an answer or wanted something done, so I did nothing. "
        "The model service is busy right now. Try again in a minute."
    )
    assert [call.model for call in provider.calls] == ["quick"]


async def test_reports_a_failed_answer_in_plain_words() -> None:
    down: list[Step] = [ReasoningError("unavailable", "The model service could not be reached.")]
    provider = ScriptedProvider({"quick": [question()], PRIMARY: [down], FALLBACK: [down]})
    final = (await run(provider, turn("Hello")))[-1]

    assert isinstance(final, TurnFailed)
    assert (final.reason, final.detail) == ("unavailable", "The model service could not be reached.")


async def test_reports_the_real_cost_of_understanding_and_answering() -> None:
    provider = ScriptedProvider({"quick": [question()], PRIMARY: [answer("Here.", PRIMARY, cost_micro_usd=7900)]})
    final = (await run(provider, turn("Hello")))[-1]

    assert isinstance(final, TurnDone)
    assert final.usage.cost_micro_usd == 7940
    assert final.usage.input_tokens == 52


async def test_a_plan_costs_the_understanding_and_the_planning() -> None:
    provider = ScriptedProvider({"quick": [task(cost_micro_usd=55)], PRIMARY: [structured(NOTEPAD_PLAN.model_dump_json(), PRIMARY, cost_micro_usd=900)]})
    final = (await run(provider, turn("Open Notepad")))[-1]

    assert isinstance(final, TurnDone)
    assert final.usage.cost_micro_usd == 955


async def test_answers_with_the_models_of_the_chosen_engine() -> None:
    utopia = get_engine("utopia").models[0]
    provider = ScriptedProvider({"quick": [question()], utopia: [answer("Deep answer.", utopia)]})
    final = (await run(provider, turn("Think hard", engine="utopia")))[-1]

    assert isinstance(final, TurnDone)
    assert final.model == utopia


async def test_refuses_an_engine_with_no_model_offered() -> None:
    catalogue = EngineCatalogue(("quick",))
    catalogue.update({"quick": ListedModel(tools=True, sees=False)})
    provider = ScriptedProvider({})
    final = (await run(provider, turn("Hello"), catalogue))[-1]

    assert isinstance(final, TurnFailed)
    assert final.reason == "not_configured"
    assert "Titan is not available" in final.detail
    assert provider.calls == []


def test_keeps_the_most_recent_history_within_budget() -> None:
    history = [ConversationEntry(speaker="user", text=str(index) * 10) for index in range(5)]
    assert [entry.text[0] for entry in recent(history, 25)] == ["3", "4"]


def test_cuts_an_answer_that_is_too_long() -> None:
    cut = fit("x" * (ANSWER_CHARACTERS + 50))
    assert len(cut) <= ANSWER_CHARACTERS
    assert cut.endswith("length limit.*")


SAVED = datetime(2026, 10, 31, 8, 15, tzinfo=UTC)


async def test_answers_with_what_it_remembers() -> None:
    metric = MemoryContext(type="preference", content="I prefer metric units", saved_at=SAVED)
    provider = ScriptedProvider({"quick": [question()], PRIMARY: [answer("About 880 km.", PRIMARY)]})
    await run(provider, turn("How far is Berlin from Paris?", memories=[metric]))

    assert [call.model for call in provider.calls] == ["quick", PRIMARY]
    assert "Remembered:" not in provider.calls[0].system
    assert provider.calls[1].system.endswith("- (preference, saved 2026-10-31) I prefer metric units")


async def test_confirms_a_saved_memory_without_treating_it_as_a_task() -> None:
    reminder = MemoryContext(type="event", content="I have a dentist appointment on Friday", saved_at=SAVED)
    provider = ScriptedProvider({PRIMARY: [answer("I will remember your dentist appointment.", PRIMARY)]})
    final = (await run(provider, turn("Remember that I have a dentist appointment on Friday", remembered=reminder)))[-1]

    assert isinstance(final, TurnDone)
    assert (final.intent, final.text) == ("question", "I will remember your dentist appointment.")
    assert [call.model for call in provider.calls] == [PRIMARY]
    assert "Just saved:" in provider.calls[0].system
