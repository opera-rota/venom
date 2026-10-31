from collections.abc import AsyncGenerator, Mapping

import openai
from openai.types import CompletionUsage
from openai.types.chat import (
    ChatCompletionChunk,
    ChatCompletionMessageParam,
    ChatCompletionNamedToolChoiceParam,
    ChatCompletionToolParam,
)
from pydantic import BaseModel

from venom_reasoning.errors import ReasoningError
from venom_reasoning.provider import Completion, ModelCall, ProviderEvent, TextChunk, Thinking, Turn

OPENROUTER_URL = "https://openrouter.ai/api/v1"
RESPOND_TOOL = "respond"
ATTRIBUTION = {"HTTP-Referer": "https://github.com/opera-rota/venom", "X-Title": "VENOM"}


def create_client(api_key: str, base_url: str = OPENROUTER_URL) -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        default_headers=ATTRIBUTION,
        max_retries=1,
        timeout=openai.Timeout(120.0, connect=10.0),
    )


class OpenRouterProvider:
    def __init__(self, client: openai.AsyncOpenAI) -> None:
        self._client = client

    async def stream(self, call: ModelCall) -> AsyncGenerator[ProviderEvent]:
        try:
            if call.schema is None:
                async for event in self._text(call):
                    yield event
            else:
                yield await self._structured(call, call.schema)
        except openai.APIError as error:
            raise translate(error) from error

    async def _text(self, call: ModelCall) -> AsyncGenerator[ProviderEvent]:
        stream = await self._client.chat.completions.create(
            model=call.model,
            messages=to_messages(call),
            max_tokens=call.max_output_tokens,
            stream=True,
        )
        parts: list[str] = []
        model = call.model
        stop_reason: str | None = None
        usage: CompletionUsage | None = None
        async with stream:
            async for chunk in stream:
                refuse_stream_error(chunk)
                model = chunk.model or model
                usage = chunk.usage or usage
                for choice in chunk.choices:
                    stop_reason = choice.finish_reason or stop_reason
                    text = choice.delta.content
                    if text:
                        parts.append(text)
                        yield TextChunk(text)
                    elif extra(choice.delta).get("reasoning"):
                        yield Thinking()
        input_tokens, output_tokens, cost = measured(usage)
        yield Completion(
            text="".join(parts),
            model=model,
            stop_reason=stop_reason,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_micro_usd=cost,
        )

    async def _structured(self, call: ModelCall, schema: Mapping[str, object]) -> Completion:
        tool: ChatCompletionToolParam = {
            "type": "function",
            "function": {
                "name": RESPOND_TOOL,
                "description": "Give the answer in exactly the required shape.",
                "parameters": dict(schema),
            },
        }
        choice: ChatCompletionNamedToolChoiceParam = {"type": "function", "function": {"name": RESPOND_TOOL}}
        response = await self._client.chat.completions.create(
            model=call.model,
            messages=to_messages(call),
            max_tokens=call.max_output_tokens,
            tools=[tool],
            tool_choice=choice,
            parallel_tool_calls=False,
        )
        input_tokens, output_tokens, cost = measured(response.usage)
        for option in response.choices:
            for tool_call in option.message.tool_calls or ():
                if tool_call.type == "function" and tool_call.function.name == RESPOND_TOOL:
                    return Completion(
                        text=tool_call.function.arguments,
                        model=response.model or call.model,
                        stop_reason=option.finish_reason,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        cost_micro_usd=cost,
                    )
        raise ReasoningError("invalid_output", "The model did not answer in the required shape.")


async def listed_models(client: openai.AsyncOpenAI) -> dict[str, bool]:
    try:
        listed: dict[str, bool] = {}
        async for model in await client.models.list():
            supported = extra(model).get("supported_parameters")
            listed[model.id] = isinstance(supported, list) and "tools" in supported
        return listed
    except openai.APIError as error:
        raise translate(error) from error


def to_messages(call: ModelCall) -> list[ChatCompletionMessageParam]:
    messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": call.system}]
    messages.extend(to_message(turn) for turn in call.turns)
    return messages


def to_message(turn: Turn) -> ChatCompletionMessageParam:
    match turn.role:
        case "user":
            return {"role": "user", "content": turn.text}
        case "assistant":
            return {"role": "assistant", "content": turn.text}


def extra(model: BaseModel) -> dict[str, object]:
    return model.model_extra or {}


def refuse_stream_error(chunk: ChatCompletionChunk) -> None:
    failure = extra(chunk).get("error")
    if failure is not None or any(str(choice.finish_reason) == "error" for choice in chunk.choices):
        raise ReasoningError("unavailable", "The model stopped with an error while answering.")


def measured(usage: CompletionUsage | None) -> tuple[int, int, int]:
    cost = None if usage is None else extra(usage).get("cost")
    if usage is None or not isinstance(cost, int | float) or cost < 0:
        raise ReasoningError("invalid_output", "The model service did not report what the answer cost.")
    return usage.prompt_tokens, usage.completion_tokens, round(cost * 1_000_000)


def translate(error: openai.APIError) -> ReasoningError:
    match error:
        case openai.APITimeoutError():
            return ReasoningError("timeout", "The model took too long to answer.")
        case openai.APIConnectionError():
            return ReasoningError("unavailable", "The model service could not be reached.")
        case openai.AuthenticationError():
            return ReasoningError("refused", "The model service refused VENOM's key. The operator must check the OpenRouter key.")
        case openai.APIStatusError(status_code=402):
            return ReasoningError("refused", "VENOM's model account has run out of credit. The operator must add credit on OpenRouter.")
        case openai.RateLimitError():
            return ReasoningError("rate_limited", "The model service is busy right now.")
        case openai.NotFoundError():
            return ReasoningError("unavailable", "This model is not available right now.")
        case openai.APIStatusError(status_code=status) if status >= 500:
            return ReasoningError("unavailable", "The model service is having a problem right now.")
        case openai.APIStatusError():
            return ReasoningError("refused", "The model service could not accept this request.")
        case _:
            return ReasoningError("unavailable", "The model stopped with an error while answering.")
