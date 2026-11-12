import json

import httpx2
import pytest
from pydantic import TypeAdapter

from venom_contracts.models import AvailableEngines, EmbeddingFailure, Embeddings, MoveChosen, MoveFailed, MoveReply, TurnDone, TurnEvent
from venom_orchestrator.embedding import EmbeddingCatalogue, EmbeddingService
from venom_orchestrator.engines import EngineCatalogue
from venom_orchestrator.moves import MoveChooser
from venom_orchestrator.server import create_app
from venom_orchestrator.turns import Orchestrator
from venom_reasoning.openrouter_provider import ListedModel
from venom_reasoning.reasoner import Reasoner
from venom_reasoning.testing import FixedEmbedder, ScriptedProvider, answer, structured

pytestmark = pytest.mark.anyio

events_adapter: TypeAdapter[TurnEvent] = TypeAdapter(TurnEvent)
reply_adapter: TypeAdapter[MoveReply] = TypeAdapter(MoveReply)

TURN: dict[str, object] = {
    "request_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
    "account_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02",
    "device_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03",
    "engine": "dove",
    "history": [],
    "memories": [],
    "remembered": None,
    "connectors": [],
    "task_mode": "loop",
    "text": "Explain what a mutex is",
}

DOVE = "google/gemini-2.5-flash-lite"


def client(
    provider: ScriptedProvider,
    catalogue: EngineCatalogue | None = None,
    embedder: FixedEmbedder | None = None,
    embedding_model: str | None = "openai/text-embedding-3-small",
) -> httpx2.AsyncClient:
    embeddings = EmbeddingCatalogue(embedding_model or "openai/text-embedding-3-small")
    if embedding_model is None:
        embeddings.update({})
    engines = catalogue or EngineCatalogue(("quick",))
    reasoner = Reasoner(provider)
    app = create_app(
        Orchestrator(reasoner, engines),
        EmbeddingService(embedder or FixedEmbedder(), embeddings),
        MoveChooser(reasoner, engines),
    )
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://brain")


async def test_streams_turn_events_as_lines() -> None:
    provider = ScriptedProvider({"quick": [structured('{"kind": "question"}', "quick")], DOVE: [answer("A mutex is a lock.", DOVE)]})
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


async def test_lists_the_engines_that_can_answer_right_now() -> None:
    catalogue = EngineCatalogue(("quick",))
    catalogue.update({DOVE: ListedModel(tools=False, sees=False), "anthropic/claude-opus-5.5": ListedModel(tools=False, sees=False)})
    async with client(ScriptedProvider({}), catalogue) as brain:
        response = await brain.get("/v1/engines")

    assert AvailableEngines.model_validate_json(response.text).available == ["dove", "breeze", "pebble", "stormi", "utopia"]


EMBED = {"request_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01", "texts": ["I prefer metric units", "What units do I like?"]}


async def test_embeds_texts_with_the_chosen_model() -> None:
    embedder = FixedEmbedder(cost_micro_usd=3)
    async with client(ScriptedProvider({}), embedder=embedder) as brain:
        response = await brain.post("/v1/embeddings", json=EMBED)

    assert response.status_code == 200
    result = Embeddings.model_validate_json(response.text)
    assert result.model == "openai/text-embedding-3-small"
    assert len(result.vectors) == 2
    assert result.usage.cost_micro_usd == 3
    assert embedder.calls == [("openai/text-embedding-3-small", ["I prefer metric units", "What units do I like?"])]


async def test_says_plainly_when_no_embedding_model_is_offered() -> None:
    async with client(ScriptedProvider({}), embedding_model=None) as brain:
        response = await brain.post("/v1/embeddings", json=EMBED)

    assert response.status_code == 503
    assert EmbeddingFailure.model_validate_json(response.text).error == "not_configured"


async def test_refuses_an_empty_embedding_request() -> None:
    async with client(ScriptedProvider({})) as brain:
        response = await brain.post("/v1/embeddings", json={**EMBED, "texts": []})
    assert response.status_code == 400


MOVE: dict[str, object] = {
    "request_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
    "account_id": "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02",
    "engine": "turbo",
    "goal": "Write hello in Notepad",
    "moves": [],
    "guidance": [],
    "memories": [],
    "observation": {
        "picture": "/9j/4AAQSkZJRg==",
        "width": 1280,
        "height": 720,
        "window": "Untitled - Notepad",
        "app": "Notepad",
        "marks": [{"id": 1, "kind": "box", "name": "Text editor", "editable": True, "password": False, "box": {"x": 0, "y": 80, "width": 1280, "height": 600}}],
        "focused": 1,
    },
}

HAIKU = "anthropic/claude-haiku-5.5"


async def test_chooses_one_move_from_a_look() -> None:
    chosen = '{"seen": "An empty Notepad.", "next": {"kind": "move", "intent": "Type hello", "effects": [], "move": {"name": "type", "text": "hello", "mark": 1, "enter": false}}}'
    async with client(ScriptedProvider({HAIKU: [structured(chosen, HAIKU)]})) as brain:
        response = await brain.post("/v1/moves", json=MOVE)

    assert response.status_code == 200
    reply = reply_adapter.validate_json(response.text)
    assert isinstance(reply, MoveChosen)
    assert reply.next.seen == "An empty Notepad."
    assert reply.model == HAIKU


async def test_says_plainly_when_the_engine_cannot_see() -> None:
    catalogue = EngineCatalogue(("quick",))
    catalogue.update({"deepseek/deepseek-v4-pro": ListedModel(tools=True, sees=False)})
    provider = ScriptedProvider({})
    async with client(provider, catalogue) as brain:
        response = await brain.post("/v1/moves", json={**MOVE, "engine": "falcon"})

    reply = reply_adapter.validate_json(response.text)
    assert isinstance(reply, MoveFailed)
    assert reply.reason == "not_configured"
    assert reply.detail == "Falcon cannot see the screen right now. Choose an engine that can see, for example Turbo, in Models."
    assert provider.calls == []


async def test_refuses_a_move_request_that_names_a_model() -> None:
    async with client(ScriptedProvider({})) as brain:
        response = await brain.post("/v1/moves", json={**MOVE, "model": HAIKU})
    assert response.status_code == 400
