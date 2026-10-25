import json
from collections.abc import AsyncGenerator
from typing import cast

import anthropic
from anthropic.lib.streaming import AsyncMessageStreamManager
from anthropic.types import Message, MessageParam, ToolChoiceToolParam, ToolParam
from anthropic.types.tool_param import InputSchema

from venom_reasoning.errors import ReasoningError
from venom_reasoning.provider import Completion, ModelCall, ProviderEvent, TextChunk, Turn

RESPOND_TOOL = "respond"


class AnthropicProvider:
    def __init__(self, client: anthropic.AsyncAnthropic) -> None:
        self._client = client

    async def stream(self, call: ModelCall) -> AsyncGenerator[ProviderEvent]:
        try:
            async with self._open(call) as stream:
                if call.schema is None:
                    async for text in stream.text_stream:
                        if text:
                            yield TextChunk(text)
                message = await stream.get_final_message()
        except anthropic.APIError as error:
            raise translate(error) from error
        yield Completion(
            text=final_text(message, call),
            model=message.model,
            stop_reason=message.stop_reason,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
        )

    def _open(self, call: ModelCall) -> AsyncMessageStreamManager[None]:
        messages = [to_message(turn) for turn in call.turns]
        if call.schema is None:
            return self._client.messages.stream(
                model=call.model,
                max_tokens=call.max_output_tokens,
                system=call.system,
                messages=messages,
            )
        tool: ToolParam = {
            "name": RESPOND_TOOL,
            "description": "Give the answer in exactly the required shape.",
            "input_schema": cast(InputSchema, dict(call.schema)),
        }
        choice: ToolChoiceToolParam = {"type": "tool", "name": RESPOND_TOOL, "disable_parallel_tool_use": True}
        return self._client.messages.stream(
            model=call.model,
            max_tokens=call.max_output_tokens,
            system=call.system,
            messages=messages,
            tools=[tool],
            tool_choice=choice,
        )


def to_message(turn: Turn) -> MessageParam:
    match turn.role:
        case "user":
            return {"role": "user", "content": turn.text}
        case "assistant":
            return {"role": "assistant", "content": turn.text}


def final_text(message: Message, call: ModelCall) -> str:
    if call.schema is None:
        return "".join(block.text for block in message.content if block.type == "text")
    for block in message.content:
        if block.type == "tool_use" and block.name == RESPOND_TOOL:
            return json.dumps(block.input)
    raise ReasoningError("invalid_output", "The model did not answer in the required shape.")


def translate(error: anthropic.APIError) -> ReasoningError:
    match error:
        case anthropic.APITimeoutError():
            return ReasoningError("timeout", "The model took too long to answer.")
        case anthropic.APIConnectionError():
            return ReasoningError("unavailable", "The model service could not be reached.")
        case anthropic.AuthenticationError() | anthropic.PermissionDeniedError():
            return ReasoningError("refused", "The model service refused VENOM's API key.")
        case anthropic.RateLimitError():
            return ReasoningError("rate_limited", "The model service is busy right now.")
        case anthropic.APIStatusError(status_code=status) if status >= 500:
            return ReasoningError("unavailable", "The model service is having a problem right now.")
        case anthropic.APIStatusError() if "credit" in error.message.lower():
            return ReasoningError("refused", "The model account has run out of credit. Add credit in the Claude Console.")
        case anthropic.APIStatusError():
            return ReasoningError("refused", "The model service could not accept this request.")
        case _:
            return ReasoningError("internal", "Something unexpected went wrong while talking to the model.")
