# /// script
# requires-python = ">=3.14"
# dependencies = ["openai==3.29.0"]
# ///
import os
import sys

import openai

PROMPT = "Reply with exactly these words and nothing else: VENOM is alive."


def explain(error: openai.APIError) -> str:
    match error:
        case openai.AuthenticationError():
            return "The key was refused. Create a new key at openrouter.ai/settings/keys and store it again."
        case openai.APIStatusError(status_code=402):
            return "OpenRouter asked for credit. Check that the model name ends with :free."
        case openai.RateLimitError():
            return "Every free model is busy or today's free requests are used up. Wait a few minutes, then try again."
        case openai.APIConnectionError():
            return "Could not reach openrouter.ai. Check the internet connection, then try again."
        case openai.APIStatusError(status_code=status):
            return f"OpenRouter answered with status {status}: {error.message}"
        case _:
            return f"OpenRouter stopped with an error: {error.message}"


def free_models(client: openai.OpenAI) -> list[str]:
    free: list[str] = []
    for model in client.models.list():
        supported = (model.model_extra or {}).get("supported_parameters")
        if model.id.endswith(":free") and isinstance(supported, list) and "tools" in supported:
            free.append(model.id)
    return sorted(free)[:6]


def show_allowance(client: openai.OpenAI) -> None:
    key = client.get("/key", cast_to=object)
    data = key.get("data", {}) if isinstance(key, dict) else {}
    daily = data.get("free_model_daily_requests") if isinstance(data, dict) else None
    if isinstance(daily, dict):
        print(f"Free requests left today: {daily.get('remaining')} of {daily.get('limit')}")


def main() -> int:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        print("OPENROUTER_API_KEY is not set in this terminal. Close the terminal, open a new one, and run this again.")
        return 1
    client = openai.OpenAI(
        api_key=key,
        base_url="https://openrouter.ai/api/v1",
        default_headers={"HTTP-Referer": "https://github.com/opera-rota/venom", "X-Title": "VENOM"},
        timeout=60.0,
        max_retries=1,
    )
    try:
        show_allowance(client)
        candidates = free_models(client)
    except openai.APIError as error:
        print(explain(error))
        return 1
    if not candidates:
        print("OpenRouter offers no free model right now. Try again later.")
        return 1

    last: openai.APIError | None = None
    for model in candidates:
        try:
            reply = client.chat.completions.create(model=model, max_tokens=400, messages=[{"role": "user", "content": PROMPT}])
        except (openai.RateLimitError, openai.NotFoundError, openai.InternalServerError) as error:
            print(f"{model} is busy, trying the next free model")
            last = error
            continue
        except openai.APIError as error:
            print(explain(error))
            return 1
        text = (reply.choices[0].message.content or "").strip() if reply.choices else ""
        if not text:
            print(f"{model} gave an empty reply, trying the next free model")
            continue
        print(f"Model:  {reply.model}")
        print(f"Reply:  {text}")
        if reply.usage is not None:
            cost = (reply.usage.model_extra or {}).get("cost", 0)
            print(f"Tokens: {reply.usage.prompt_tokens} in, {reply.usage.completion_tokens} out")
            print(f"Cost:   ${cost}")
        return 0

    print(explain(last) if last is not None else "No free model answered. Wait a few minutes, then try again.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
