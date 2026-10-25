from uuid import UUID

import pytest

from venom_contracts.models import ConversationEntry, PromptRole, TurnDelta, TurnDone, TurnEvent, TurnFailed, TurnRequest
from venom_orchestrator.turns import ANSWER_CHARACTERS, TASK_REPLY, Orchestrator, fit, recent
from venom_reasoning.errors import ReasoningError
from venom_reasoning.reasoner import Limits, Reasoner
from venom_reasoning.testing import ScriptedProvider, Step, answer, structured

pytestmark = pytest.mark.anyio

MODELS: dict[PromptRole, tuple[str, ...]] = {"understand": ("quick",), "reply": ("primary", "fallback")}


def turn(text: str, history: list[ConversationEntry] | None = None) -> TurnRequest:
    return TurnRequest(
        request_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01"),
        account_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02"),
        device_id=UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03"),
        history=history or [],
        text=text,
    )


async def run(provider: ScriptedProvider, request: TurnRequest) -> list[TurnEvent]:
    orchestrator = Orchestrator(Reasoner(provider, MODELS, Limits(first_output=0.5, idle=0.5, total=2.0)))
    return [event async for event in orchestrator.run(request)]


def question() -> list[Step]:
    return structured('{"kind": "question"}', "quick")


async def test_answers_a_question_as_a_stream() -> None:
    provider = ScriptedProvider({"quick": [question()], "primary": [answer("A mutex is a lock for shared data.", "primary")]})
    events = await run(provider, turn("Explain what a mutex is"))

    assert "".join(event.text for event in events if isinstance(event, TurnDelta)) == "A mutex is a lock for shared data."
    final = events[-1]
    assert isinstance(final, TurnDone)
    assert (final.intent, final.model, final.text) == ("question", "primary", "A mutex is a lock for shared data.")
    assert [call.model for call in provider.calls] == ["quick", "primary"]


async def test_sends_the_conversation_so_far() -> None:
    history = [
        ConversationEntry(speaker="user", text="What is a thread?"),
        ConversationEntry(speaker="venom", text="One path of execution."),
    ]
    provider = ScriptedProvider({"quick": [question()], "primary": [answer("Yes, threads share memory.", "primary")]})
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
    provider = ScriptedProvider({"quick": [down], "primary": [answer("Here is the answer.", "primary")]})
    final = (await run(provider, turn("Hello")))[-1]

    assert isinstance(final, TurnDone)
    assert final.intent == "question"


async def test_reports_a_failed_answer_in_plain_words() -> None:
    down: list[Step] = [ReasoningError("unavailable", "The model service could not be reached.")]
    provider = ScriptedProvider({"quick": [question()], "primary": [down], "fallback": [down]})
    final = (await run(provider, turn("Hello")))[-1]

    assert isinstance(final, TurnFailed)
    assert (final.reason, final.detail) == ("unavailable", "The model service could not be reached.")


def test_keeps_the_most_recent_history_within_budget() -> None:
    history = [ConversationEntry(speaker="user", text=str(index) * 10) for index in range(5)]
    assert [entry.text[0] for entry in recent(history, 25)] == ["3", "4"]


def test_cuts_an_answer_that_is_too_long() -> None:
    cut = fit("x" * (ANSWER_CHARACTERS + 50))
    assert len(cut) <= ANSWER_CHARACTERS
    assert cut.endswith("length limit.*")
