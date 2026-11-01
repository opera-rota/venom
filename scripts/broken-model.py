import json
import sys
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import cycle
from typing import Any

PORT = 4300
MODEL = "venom/broken-planner:free"

BROKEN_PLANS: Iterator[str] = cycle(
    [
        json.dumps(
            {
                "title": "Clean up the computer",
                "steps": [{"summary": "Delete everything in Downloads", "spec": {"name": "shell", "command": "rm -rf ~/Downloads"}}],
                "cannot": None,
            }
        ),
        json.dumps(
            {
                "title": "Open Notepad",
                "steps": [{"summary": "Open Notepad", "spec": {"name": "open_app", "app": "Notepad"}, "effects": [], "reversible": True}],
                "cannot": "I cannot open Notepad.",
            }
        ),
        '{"title": "Half a plan", "steps": [{"summary": "Open',
    ]
)


def completion(arguments: str) -> dict[str, Any]:
    return {
        "id": f"broken-{time.time_ns()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "respond", "arguments": arguments}}],
                },
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20, "cost": 0},
    }


def chunk(text: str | None, finish: str | None) -> bytes:
    delta = {} if text is None else {"role": "assistant", "content": text}
    body = {
        "id": "broken-stream",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": MODEL,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if finish is not None:
        body["usage"] = {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20, "cost": 0}
    return f"data: {json.dumps(body)}\n\n".encode()


class BrokenModel(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path.endswith("/embeddings/models"):
            self.reply({"data": []})
        elif self.path.endswith("/models"):
            self.reply({"data": [{"id": MODEL, "object": "model", "created": 0, "owned_by": "venom", "supported_parameters": ["tools", "tool_choice"]}]})
        else:
            self.reply({"error": {"message": "Not found", "code": 404}}, 404)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length) or b"{}")
        if not self.path.endswith("/chat/completions"):
            self.reply({"error": {"message": "Not found", "code": 404}}, 404)
            return
        tools = request.get("tools") or []
        if tools:
            properties = tools[0]["function"]["parameters"].get("properties", {})
            if "steps" in properties:
                plan = next(BROKEN_PLANS)
                print(f"sent a broken plan: {plan[:80]}", flush=True)
                self.reply(completion(plan))
            else:
                print("understood the message as a task", flush=True)
                self.reply(completion('{"kind": "task"}'))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(chunk("I am the broken model server. I only answer to break plans.", None))
        self.wfile.write(chunk(None, "stop"))
        self.wfile.write(b"data: [DONE]\n\n")

    def reply(self, body: dict[str, Any], status: int = 200) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), BrokenModel)
    print(f"broken model server listening on http://127.0.0.1:{PORT}/api/v1 (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
