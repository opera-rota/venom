# /// script
# requires-python = ">=3.14"
# dependencies = ["anthropic==2.3.0"]
# ///
import os
import sys

import anthropic

MODEL = "claude-haiku-5-5"
PROMPT = "Reply with exactly these words and nothing else: VENOM is alive."


def main() -> int:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set in this terminal. Close the terminal, open a new one, and run this again.")
        return 1
    client = anthropic.Anthropic(timeout=30.0, max_retries=2)
    try:
        reply = client.messages.create(model=MODEL, max_tokens=32, messages=[{"role": "user", "content": PROMPT}])
    except anthropic.AuthenticationError:
        print("The API key was refused. Create a new key in the Claude Console and store it again.")
        return 1
    except anthropic.PermissionDeniedError:
        print("The key is valid but this account cannot use this model yet. Check Billing in the Claude Console.")
        return 1
    except anthropic.RateLimitError:
        print("Too many requests or no credit left. Check Billing in the Claude Console, then try again.")
        return 1
    except anthropic.APIConnectionError:
        print("Could not reach api.anthropic.com. Check the internet connection, then try again.")
        return 1
    except anthropic.APIStatusError as error:
        print(f"The API answered with status {error.status_code}: {error.message}")
        return 1
    text = "".join(block.text for block in reply.content if block.type == "text").strip()
    print(f"Model:  {reply.model}")
    print(f"Reply:  {text}")
    print(f"Tokens: {reply.usage.input_tokens} in, {reply.usage.output_tokens} out")
    return 0 if text.rstrip(".") == "VENOM is alive" else 1


if __name__ == "__main__":
    sys.exit(main())
