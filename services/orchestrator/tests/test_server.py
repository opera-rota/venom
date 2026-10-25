import json

import httpx2
import pytest
from pydantic import TypeAdapter

from venom_contracts.models import TurnDone, TurnEvent
from venom_orchestrator.server import create_app
from venom_orchestrator.turns import Orchestrator
from venom_reasoning.reasoner import Reasoner
from venom_reasoning.testing import ScriptedProvider, answer, structured

pytestmark = pytest.mark.anyio

events_adapter: TypeAdapter[TurnEvent] = TypeAdapter(TurnEvent)

TURN: dict[str, object] = {
    "request_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
    "account_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02",
    "device_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03",
    "history": [],
    "text": "Explain what a mutex is",
}


def client(provider: ScriptedProvider) -> httpx2.AsyncClient:
    app = create_app(Orchestrator(Reasoner(provider, {"understand": ("quick",), "reply": ("primary",)})))
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://brain")


async def test_streams_turn_events_as_lines() -> None:
    provider = ScriptedProvider({"quick": [structured('{"kind": "question"}', "quick")], "primary": [answer("A mutex is a lock.", "primary")]})
    async with client(provider) as brain:
        response = await brain.post("/v1/turns", json=TURN)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    events = [events_adapter.validate_json(line) for line in response.text.splitlines()]
    final = events[-1]
    assert isinstance(final, TurnDone)
    assert final.text == "A mutex is a lock."


async def test_refuses_a_turn_with_unknown_fields() -> None:
    async with client(ScriptedProvider({})) as brain:
        response = await brain.post("/v1/turns", json={**TURN, "model": "anything"})

    assert response.status_code == 400
    body = json.loads(response.text)
    assert body["error"] == "invalid_request"


async def test_answers_health_checks() -> None:
    async with client(ScriptedProvider({})) as brain:
        response = await brain.get("/healthz")
    assert response.json() == {"status": "ok"}
