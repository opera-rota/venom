from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

import pytest

from venom_contracts.models import (
    ConversationEntry,
    MemoryContext,
    PromptRole,
    ReasoningDelta,
    ReasoningDone,
    ReasoningEvent,
    ReasoningFailed,
    ReasoningOutput,
    ReasoningRequest,
    StructuredOutput,
    TextOutput,
)
from venom_contracts.prompts import get_prompt
from venom_reasoning.errors import ReasoningError
from venom_reasoning.provider import Thinking
from venom_reasoning.reasoner import Limits, Reasoner, to_turns
from venom_reasoning.testing import Pause, ScriptedProvider, Step, answer, structured

pytestmark = pytest.mark.anyio

REQUEST_ID = UUID("0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01")
FAST = Limits(first_output=0.2, idle=0.2, total=2.0)
MODELS: dict[PromptRole, tuple[str, ...]] = {"reply": ("primary", "fallback"), "understand": ("quick",)}


def request(
    text: str,
    *,
    role: PromptRole = "reply",
    output: ReasoningOutput | None = None,
    version: int | None = None,
    memories: list[MemoryContext] | None = None,
    remembered: MemoryContext | None = None,
) -> ReasoningRequest:
    return ReasoningRequest(
        request_id=REQUEST_ID,
        role=role,
        prompt_version=version or get_prompt(role).version,
        messages=[ConversationEntry(speaker="user", text=text)],
        memories=memories or [],
        remembered=remembered,
        output=output or TextOutput(kind="text"),
        max_output_tokens=512,
    )


async def run(provider: ScriptedProvider, ask: ReasoningRequest) -> list[ReasoningEvent]:
    reasoner = Reasoner(provider, FAST)
    return [event async for event in reasoner.reason(ask, MODELS.get(ask.role, ()))]


def deltas(events: Sequence[ReasoningEvent]) -> str:
    return "".join(event.text for event in events if isinstance(event, ReasoningDelta))


async def test_streams_the_answer_then_finishes() -> None:
    provider = ScriptedProvider({"primary": [answer("A mutex lets one thread in at a time.", "primary")]})
    events = await run(provider, request("Explain what a mutex is"))

    assert deltas(events) == "A mutex lets one thread in at a time."
    final = events[-1]
    assert isinstance(final, ReasoningDone)
    assert (final.model, final.text) == ("primary", "A mutex lets one thread in at a time.")
    assert provider.calls[0].system == get_prompt("reply").text
    assert provider.closed == 1


async def test_falls_back_when_the_first_model_is_silent_too_long() -> None:
    stuck: list[Step] = [Pause(5.0)]
    provider = ScriptedProvider({"primary": [stuck], "fallback": [answer("Fallback answer.", "fallback")]})
    events = await run(provider, request("Hello"))

    final = events[-1]
    assert isinstance(final, ReasoningDone)
    assert final.model == "fallback"
    assert [call.model for call in provider.calls] == ["primary", "fallback"]
    assert provider.closed == 2


async def test_falls_back_when_the_first_model_is_unavailable() -> None:
    down: list[Step] = [ReasoningError("unavailable", "down")]
    provider = ScriptedProvider({"primary": [down], "fallback": [answer("Still here.", "fallback")]})
    final = (await run(provider, request("Hello")))[-1]

    assert isinstance(final, ReasoningDone)
    assert final.text == "Still here."


async def test_never_falls_back_after_text_was_shown() -> None:
    stalls: list[Step] = [*answer("Half an answer", "primary")[:-1], Pause(5.0)]
    provider = ScriptedProvider({"primary": [stalls], "fallback": [answer("Other answer.", "fallback")]})
    events = await run(provider, request("Hello"))

    assert deltas(events) == "Half an answer"
    final = events[-1]
    assert isinstance(final, ReasoningFailed)
    assert final.reason == "timeout"
    assert [call.model for call in provider.calls] == ["primary"]


async def test_does_not_retry_a_refused_request() -> None:
    refused: list[Step] = [ReasoningError("refused", "The model service refused VENOM's API key.")]
    provider = ScriptedProvider({"primary": [refused], "fallback": [answer("Never used.", "fallback")]})
    final = (await run(provider, request("Hello")))[-1]

    assert isinstance(final, ReasoningFailed)
    assert (final.reason, final.detail) == ("refused", "The model service refused VENOM's API key.")
    assert len(provider.calls) == 1


async def test_gives_up_cleanly_when_every_model_fails() -> None:
    down: list[Step] = [ReasoningError("unavailable", "The model service could not be reached.")]
    provider = ScriptedProvider({"primary": [down], "fallback": [down]})
    final = (await run(provider, request("Hello")))[-1]

    assert isinstance(final, ReasoningFailed)
    assert final.reason == "unavailable"


async def test_the_total_limit_stops_a_slow_stream() -> None:
    trickle: list[Step] = [step for chunk in answer("one two three four", "primary", chunk=4)[:-1] for step in (chunk, Pause(0.15))]
    provider = ScriptedProvider({"primary": [trickle]})
    reasoner = Reasoner(provider, Limits(first_output=1.0, idle=1.0, total=0.4))
    final = [event async for event in reasoner.reason(request("Hello"), ("primary",))][-1]

    assert isinstance(final, ReasoningFailed)
    assert final.reason == "timeout"


async def test_returns_validated_structured_output() -> None:
    provider = ScriptedProvider({"quick": [structured('{"kind": "task"}', "quick")]})
    events = await run(provider, request("Open my notes", role="understand", output=StructuredOutput(kind="structured", contract="Intent")))

    final = events[-1]
    assert isinstance(final, ReasoningDone)
    assert final.text == '{"kind":"task"}'
    schema = provider.calls[0].schema
    assert schema is not None and schema["additionalProperties"] is False


async def test_refuses_structured_output_of_the_wrong_shape() -> None:
    provider = ScriptedProvider({"quick": [structured('{"kind": "chat"}', "quick")]})
    final = (await run(provider, request("Hi", role="understand", output=StructuredOutput(kind="structured", contract="Intent"))))[-1]

    assert isinstance(final, ReasoningFailed)
    assert final.reason == "invalid_output"


async def test_refuses_an_unknown_prompt_version() -> None:
    provider = ScriptedProvider({})
    final = (await run(provider, request("Hello", version=99)))[-1]

    assert isinstance(final, ReasoningFailed)
    assert final.reason == "internal"
    assert provider.calls == []


async def test_thinking_keeps_a_slow_model_alive_without_showing_anything() -> None:
    thinking: list[Step] = [Thinking(), Pause(0.15), Thinking(), Pause(0.15), *answer("Done thinking.", "primary", cost_micro_usd=9100)]
    provider = ScriptedProvider({"primary": [thinking]})
    events = await run(provider, request("Prove it"))

    assert deltas(events) == "Done thinking."
    final = events[-1]
    assert isinstance(final, ReasoningDone)
    assert final.usage.cost_micro_usd == 9100
    assert [call.model for call in provider.calls] == ["primary"]


async def test_reports_when_no_model_is_available() -> None:
    final = (await run(ScriptedProvider({}), request("Hello", role="plan")))[-1]

    assert isinstance(final, ReasoningFailed)
    assert final.reason == "not_configured"


def test_turns_start_with_the_user_and_alternate() -> None:
    entries = [
        ConversationEntry(speaker="venom", text="Welcome"),
        ConversationEntry(speaker="user", text="One"),
        ConversationEntry(speaker="user", text="Two"),
        ConversationEntry(speaker="venom", text="Answer"),
    ]
    assert [(turn.role, turn.text) for turn in to_turns(entries)] == [("user", "One\n\nTwo"), ("assistant", "Answer")]


SAVED = datetime(2026, 10, 31, 8, 15, tzinfo=UTC)


async def test_lists_what_venom_remembers_after_the_rules() -> None:
    provider = ScriptedProvider({"primary": [answer("Berlin is about 880 km from Paris.", "primary")]})
    metric = MemoryContext(type="preference", content="I prefer metric units", saved_at=SAVED)
    await run(provider, request("How far is Berlin from Paris?", memories=[metric]))

    system = provider.calls[0].system
    assert system.startswith(get_prompt("reply").text)
    assert system.endswith("Remembered:\n- (preference, saved 2026-10-31) I prefer metric units")
    assert "Just saved:\n" not in system


async def test_marks_what_was_just_saved() -> None:
    provider = ScriptedProvider({"primary": [answer("I will remember that.", "primary")]})
    sister = MemoryContext(type="event", content="My sister Ana's birthday is on 12 March", saved_at=SAVED)
    await run(provider, request("Remember that my sister Ana's birthday is on 12 March", remembered=sister))

    assert provider.calls[0].system.endswith("Just saved:\n- (event, saved 2026-10-31) My sister Ana's birthday is on 12 March")


async def test_sends_only_the_rules_when_nothing_is_remembered() -> None:
    provider = ScriptedProvider({"primary": [answer("Hello!", "primary")]})
    await run(provider, request("Hello"))
    assert provider.calls[0].system == get_prompt("reply").text
