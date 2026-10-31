import json
from collections.abc import Callable, Mapping

import httpx2
import openai
import pytest

from venom_reasoning.errors import ReasoningError
from venom_reasoning.openrouter_provider import ATTRIBUTION, OpenRouterProvider, listed_models
from venom_reasoning.provider import Completion, ModelCall, ProviderEvent, TextChunk, Thinking, Turn

pytestmark = pytest.mark.anyio

type Handler = Callable[[httpx2.Request], httpx2.Response]

MODEL = "anthropic/claude-sonnet-5.5"
USAGE = {"prompt_tokens": 1840, "completion_tokens": 96, "total_tokens": 1936, "cost": 0.00464}


def chunk(delta: Mapping[str, object] | None = None, *, finish: str | None = None, usage: Mapping[str, object] | None = None) -> dict[str, object]:
    choices = [] if delta is None else [{"index": 0, "delta": dict(delta), "finish_reason": finish}]
    body: dict[str, object] = {"id": "gen-1", "object": "chat.completion.chunk", "created": 1, "model": MODEL, "choices": choices}
    if usage is not None:
        body["usage"] = dict(usage)
    return body


def sse(*chunks: Mapping[str, object]) -> bytes:
    lines = [f"data: {json.dumps(item)}\n\n" for item in chunks]
    return ("".join(lines) + "data: [DONE]\n\n").encode()


def streamed(*chunks: Mapping[str, object]) -> Handler:
    return lambda _request: httpx2.Response(200, content=sse(*chunks), headers={"content-type": "text/event-stream"})


def provider(handler: Handler, seen: list[httpx2.Request]) -> OpenRouterProvider:
    def record(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return handler(request)

    client = openai.AsyncOpenAI(
        api_key="sk-or-test",
        base_url="https://openrouter.test/api/v1",
        default_headers=ATTRIBUTION,
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(record)),
    )
    return OpenRouterProvider(client)


def call(schema: dict[str, object] | None = None) -> ModelCall:
    return ModelCall(
        model=MODEL,
        system="You are VENOM.",
        turns=[Turn("user", "Explain what a mutex is")],
        max_output_tokens=256,
        schema=schema,
    )


async def collect(subject: OpenRouterProvider, request: ModelCall) -> list[ProviderEvent]:
    return [event async for event in subject.stream(request)]


async def test_streams_text_and_reports_real_cost() -> None:
    seen: list[httpx2.Request] = []
    handler = streamed(
        chunk({"role": "assistant", "content": "A mutex "}),
        chunk({"content": "is a lock."}),
        chunk({}, finish="stop"),
        chunk(usage=USAGE),
    )
    events = await collect(provider(handler, seen), call())

    assert [event.text for event in events if isinstance(event, TextChunk)] == ["A mutex ", "is a lock."]
    final = events[-1]
    assert final == Completion(
        text="A mutex is a lock.",
        model=MODEL,
        stop_reason="stop",
        input_tokens=1840,
        output_tokens=96,
        cost_micro_usd=4640,
    )
    body = json.loads(seen[0].content)
    assert body["model"] == MODEL
    assert body["stream"] is True
    assert body["messages"][0] == {"role": "system", "content": "You are VENOM."}
    assert seen[0].headers["x-title"] == "VENOM"
    assert seen[0].headers["authorization"] == "Bearer sk-or-test"


async def test_reports_thinking_without_showing_it() -> None:
    handler = streamed(
        chunk({"role": "assistant", "content": "", "reasoning": "Let me think."}),
        chunk({"content": "Done."}, finish="stop"),
        chunk(usage=USAGE),
    )
    events = await collect(provider(handler, []), call())

    assert isinstance(events[0], Thinking)
    assert isinstance(events[1], TextChunk)


async def test_structured_output_uses_a_forced_function() -> None:
    seen: list[httpx2.Request] = []
    response = {
        "id": "gen-2",
        "object": "chat.completion",
        "created": 1,
        "model": "anthropic/claude-haiku-5.5",
        "choices": [
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"id": "call_1", "type": "function", "function": {"name": "respond", "arguments": '{"kind": "task"}'}}
                    ],
                },
            }
        ],
        "usage": {"prompt_tokens": 240, "completion_tokens": 8, "total_tokens": 248, "cost": 0.000028},
    }
    subject = provider(lambda _request: httpx2.Response(200, json=response), seen)
    events = await collect(subject, call({"type": "object", "properties": {"kind": {"type": "string"}}}))

    final = events[-1]
    assert isinstance(final, Completion)
    assert (final.text, final.cost_micro_usd, final.model) == ('{"kind": "task"}', 28, "anthropic/claude-haiku-5.5")
    body = json.loads(seen[0].content)
    assert body["tool_choice"] == {"type": "function", "function": {"name": "respond"}}
    assert body["tools"][0]["function"]["parameters"]["properties"]["kind"] == {"type": "string"}


async def test_an_error_in_the_middle_of_a_stream_is_not_hidden() -> None:
    handler = streamed(
        chunk({"role": "assistant", "content": "Half an"}),
        {**chunk({}, finish="error"), "error": {"code": 502, "message": "upstream died"}},
    )
    with pytest.raises(ReasoningError) as raised:
        await collect(provider(handler, []), call())
    assert raised.value.reason == "unavailable"


async def test_an_answer_without_a_cost_is_refused() -> None:
    handler = streamed(chunk({"role": "assistant", "content": "Hi"}, finish="stop"))
    with pytest.raises(ReasoningError) as raised:
        await collect(provider(handler, []), call())
    assert raised.value.reason == "invalid_output"


@pytest.mark.parametrize(
    ("status", "reason", "words"),
    [
        (401, "refused", "OpenRouter key"),
        (402, "refused", "run out of credit"),
        (404, "unavailable", "not available"),
        (429, "rate_limited", "busy"),
        (503, "unavailable", "having a problem"),
        (400, "refused", "could not accept"),
    ],
)
async def test_translates_service_errors(status: int, reason: str, words: str) -> None:
    handler: Handler = lambda _request: httpx2.Response(status, json={"error": {"code": status, "message": "no"}})
    with pytest.raises(ReasoningError) as raised:
        await collect(provider(handler, []), call())
    assert raised.value.reason == reason
    assert words in raised.value.detail


async def test_translates_a_connection_failure() -> None:
    def broken(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("offline", request=request)

    with pytest.raises(ReasoningError) as raised:
        await collect(provider(broken, []), call())
    assert raised.value.reason == "unavailable"


async def test_lists_models_and_which_can_use_tools() -> None:
    listing = {
        "data": [
            {"id": "anthropic/claude-haiku-5.5", "object": "model", "created": 1, "owned_by": "anthropic", "supported_parameters": ["tools", "max_tokens"]},
            {"id": "meta-llama/llama-4-scout", "object": "model", "created": 1, "owned_by": "meta", "supported_parameters": ["max_tokens"]},
        ]
    }
    seen: list[httpx2.Request] = []
    subject = provider(lambda _request: httpx2.Response(200, json=listing), seen)
    listed = await listed_models(subject._client)  # pyright: ignore[reportPrivateUsage]

    assert listed == {"anthropic/claude-haiku-5.5": True, "meta-llama/llama-4-scout": False}
    assert seen[0].url.path == "/api/v1/models"
