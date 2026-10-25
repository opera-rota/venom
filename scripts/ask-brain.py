# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BRAIN = os.environ.get("VENOM_BRAIN_URL", "http://127.0.0.1:4200")


def main() -> int:
    question = " ".join(sys.argv[1:]).strip()
    if not question:
        print('Write a question after the command, for example: uv run scripts/ask-brain.py "Explain what a mutex is"')
        return 1
    turn = {
        "request_id": str(uuid.uuid7()),
        "account_id": str(uuid.uuid7()),
        "device_id": str(uuid.uuid7()),
        "history": [],
        "text": question,
    }
    request = urllib.request.Request(
        f"{BRAIN}/v1/turns",
        data=json.dumps(turn).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            for line in response:
                event = json.loads(line)
                match event["type"]:
                    case "delta":
                        print(event["text"], end="", flush=True)
                    case "done":
                        print(f"\n\n[{event['intent']}, answered by {event['model'] or 'VENOM itself'}]")
                        return 0
                    case "failed":
                        print(f"\n\n[failed: {event['detail']}]")
                        return 1
    except urllib.error.HTTPError as error:
        print(f"The brain refused the question ({error.code}).")
        return 1
    except urllib.error.URLError:
        print("The brain is not running. Start it in another terminal with: pnpm brain")
        return 1
    print("\n\n[the brain stopped before finishing]")
    return 1


if __name__ == "__main__":
    sys.exit(main())
