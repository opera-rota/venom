import json
from collections.abc import Callable, Mapping

import anthropic
import httpx2
import pytest

from venom_reasoning.anthropic_provider import AnthropicProvider
from venom_reasoning.errors import ReasoningError
from venom_reasoning.provider import Completion, ModelCall, ProviderEvent, TextChunk, Turn

pytestmark = pytest.mark.anyio

type Handler = Callable[[httpx2.Request], httpx2.Response]


def sse(*events: Mapping[str, object]) -> bytes:
    return "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events).encode()


def message_start(model: str) -> dict[str, object]:
    return {
        "type": "message_start",
        "message": {
            "id": "msg_01",
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [],
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {"input_tokens": 21, "output_tokens": 1},
        },
    }


def message_end(stop_reason: str, output_tokens: int) -> list[dict[str, object]]:
    return [
        {"type": "message_delta", "delta": {"stop_reason": stop_reason, "stop_sequence": None}, "usage": {"output_tokens": output_tokens}},
        {"type": "message_stop"},
    ]


def text_stream(model: str, pieces: list[str]) -> bytes:
    return sse(
        message_start(model),
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        *({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": piece}} for piece in pieces),
        {"type": "content_block_stop", "index": 0},
        *message_end("end_turn", 9),
    )


def tool_stream(model: str, arguments: str) -> bytes:
    return sse(
        message_start(model),
        {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "toolu_01", "name": "respond", "input": {}}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": arguments}},
        {"type": "content_block_stop", "index": 0},
        *message_end("tool_use", 5),
    )


def provider(handler: Handler, seen: list[httpx2.Request]) -> AnthropicProvider:
    def record(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return handler(request)

    client = anthropic.AsyncAnthropic(
        api_key="sk-ant-test",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(record)),
    )
    return AnthropicProvider(client)


def call(schema: dict[str, object] | None = None) -> ModelCall:
    return ModelCall(
        model="claude-test",
        system="You are VENOM.",
        turns=[Turn("user", "Explain what a mutex is")],
        max_output_tokens=256,
        schema=schema,
    )


async def collect(target: AnthropicProvider, model_call: ModelCall) -> list[ProviderEvent]:
    return [event async for event in target.stream(model_call)]


def streamed(body: bytes) -> Handler:
    return lambda _request: httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body)


async def test_streams_text_and_reports_usage() -> None:
    seen: list[httpx2.Request] = []
    events = await collect(provider(streamed(text_stream("claude-test", ["A mutex ", "is a lock."])), seen), call())

    assert [event.text for event in events if isinstance(event, TextChunk)] == ["A mutex ", "is a lock."]
    final = events[-1]
    assert isinstance(final, Completion)
    assert (final.text, final.model, final.stop_reason, final.output_tokens) == ("A mutex is a lock.", "claude-test", "end_turn", 9)
    body = json.loads(seen[0].content)
    assert body["system"] == "You are VENOM."
    assert body["messages"] == [{"role": "user", "content": "Explain what a mutex is"}]
    assert "tools" not in body


async def test_structured_output_uses_a_forced_tool() -> None:
    seen: list[httpx2.Request] = []
    schema: dict[str, object] = {"type": "object", "properties": {"kind": {"type": "string"}}, "required": ["kind"]}
    events = await collect(provider(streamed(tool_stream("claude-test", '{"kind": "task"}')), seen), call(schema))

    assert len(events) == 1
    final = events[0]
    assert isinstance(final, Completion)
    assert json.loads(final.text) == {"kind": "task"}
    body = json.loads(seen[0].content)
    assert body["tool_choice"] == {"type": "tool", "name": "respond", "disable_parallel_tool_use": True}
    assert body["tools"][0]["input_schema"] == schema


@pytest.mark.parametrize(
    ("status", "message", "reason"),
    [
        (401, "invalid x-api-key", "refused"),
        (400, "Your credit balance is too low to access the Anthropic API.", "refused"),
        (429, "rate limited", "rate_limited"),
        (529, "Overloaded", "unavailable"),
    ],
)
async def test_translates_service_errors(status: int, message: str, reason: str) -> None:
    def refuse(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(status, json={"type": "error", "error": {"type": "api_error", "message": message}})

    with pytest.raises(ReasoningError) as caught:
        await collect(provider(refuse, []), call())
    assert caught.value.reason == reason


async def test_explains_when_credit_runs_out() -> None:
    def broke(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(400, json={"type": "error", "error": {"type": "invalid_request_error", "message": "Your credit balance is too low."}})

    with pytest.raises(ReasoningError) as caught:
        await collect(provider(broke, []), call())
    assert "credit" in caught.value.detail


async def test_translates_a_connection_failure() -> None:
    def offline(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("no route", request=request)

    with pytest.raises(ReasoningError) as caught:
        await collect(provider(offline, []), call())
    assert caught.value.reason == "unavailable"
