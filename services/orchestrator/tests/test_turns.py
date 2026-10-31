from uuid import UUID

import pytest

from venom_contracts.engines import get_engine
from venom_contracts.models import ConversationEntry, EngineId, TurnDelta, TurnDone, TurnEvent, TurnFailed, TurnRequest
from venom_orchestrator.engines import EngineCatalogue
from venom_orchestrator.turns import ANSWER_CHARACTERS, TASK_REPLY, Orchestrator, fit, recent
from venom_reasoning.errors import ReasoningError
from venom_reasoning.reasoner import Limits, Reasoner
from venom_reasoning.testing import ScriptedProvider, Step, answer, structured

pytestmark = pytest.mark.anyio

PRIMARY, FALLBACK = get_engine("titan").models[:2]


def turn(text: str, history: list[ConversationEntry] | None = None, engine: EngineId = "titan") -> TurnRequest:
    return TurnRequest(
        request_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01"),
        account_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02"),
        device_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03"),
        engine=engine,
        history=history or [],
        text=text,
    )


async def run(provider: ScriptedProvider, request: TurnRequest, catalogue: EngineCatalogue | None = None) -> list[TurnEvent]:
    reasoner = Reasoner(provider, Limits(first_output=0.5, idle=0.5, total=2.0))
    orchestrator = Orchestrator(reasoner, catalogue or EngineCatalogue(("quick",)))
    return [event async for event in orchestrator.run(request)]


def question() -> list[Step]:
    return structured('{"kind": "question"}', "quick")


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


async def test_does_not_pretend_to_do_a_task() -> None:
    provider = ScriptedProvider({"quick": [structured('{"kind": "task"}', "quick")]})
    events = await run(provider, turn("Open my notes app"))

    final = events[-1]
    assert isinstance(final, TurnDone)
    assert (final.intent, final.text, final.model) == ("task", TASK_REPLY, None)
    assert [call.model for call in provider.calls] == ["quick"]


async def test_treats_the_message_as_a_question_when_understanding_fails() -> None:
    down: list[Step] = [ReasoningError("unavailable", "down")]
    provider = ScriptedProvider({"quick": [down], PRIMARY: [answer("Here is the answer.", PRIMARY)]})
    final = (await run(provider, turn("Hello")))[-1]

    assert isinstance(final, TurnDone)
    assert final.intent == "question"


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


async def test_a_task_reply_costs_only_the_understanding() -> None:
    provider = ScriptedProvider({"quick": [structured('{"kind": "task"}', "quick", cost_micro_usd=55)]})
    final = (await run(provider, turn("Open my notes app")))[-1]

    assert isinstance(final, TurnDone)
    assert final.usage.cost_micro_usd == 55


async def test_answers_with_the_models_of_the_chosen_engine() -> None:
    utopia = get_engine("utopia").models[0]
    provider = ScriptedProvider({"quick": [question()], utopia: [answer("Deep answer.", utopia)]})
    final = (await run(provider, turn("Think hard", engine="utopia")))[-1]

    assert isinstance(final, TurnDone)
    assert final.model == utopia


async def test_refuses_an_engine_with_no_model_offered() -> None:
    catalogue = EngineCatalogue(("quick",))
    catalogue.update({"quick": True})
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
