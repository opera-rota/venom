# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BRAIN = os.environ.get("VENOM_BRAIN_URL", "http://127.0.0.1:4200")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ask VENOM's brain a question from the terminal.")
    parser.add_argument("--engine", default="dove", help="engine to answer with, for example dove, turbo or utopia")
    parser.add_argument("question", nargs="+", help="what to ask")
    return parser.parse_args()


def main() -> int:
    options = arguments()
    turn = {
        "request_id": str(uuid.uuid7()),
        "account_id": str(uuid.uuid7()),
        "device_id": str(uuid.uuid7()),
        "engine": options.engine,
        "history": [],
        "text": " ".join(options.question).strip(),
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
                        usage = event["usage"]
                        cost = usage["cost_micro_usd"] / 1_000_000
                        print(f"\n\n[{event['intent']}, {options.engine} answered with {event['model'] or 'VENOM itself'}, cost ${cost:.6f}]")
                        return 0
                    case "failed":
                        print(f"\n\n[failed: {event['detail']}]")
                        return 1
    except urllib.error.HTTPError as error:
        print(f"The brain refused the question ({error.code}). Check the engine name.")
        return 1
    except urllib.error.URLError:
        print("The brain is not running. Start it in another terminal with: pnpm brain")
        return 1
    print("\n\n[the brain stopped before finishing]")
    return 1


if __name__ == "__main__":
    sys.exit(main())
