import json
from collections.abc import AsyncGenerator
from contextlib import aclosing

from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from venom_contracts.models import TurnRequest
from venom_orchestrator.turns import Orchestrator

NDJSON = "application/x-ndjson"


def create_app(orchestrator: Orchestrator) -> Starlette:
    async def turns(request: Request) -> Response:
        try:
            turn = TurnRequest.model_validate_json(await request.body())
        except ValidationError as error:
            issues = json.loads(error.json(include_url=False, include_input=False, include_context=False))
            return JSONResponse({"error": "invalid_request", "issues": issues}, status_code=400)
        return StreamingResponse(lines(orchestrator, turn), media_type=NDJSON, headers={"cache-control": "no-store"})

    async def health(_request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    return Starlette(
        routes=[
            Route("/v1/turns", turns, methods=["POST"]),
            Route("/healthz", health, methods=["GET"]),
        ],
    )


async def lines(orchestrator: Orchestrator, turn: TurnRequest) -> AsyncGenerator[str]:
    async with aclosing(orchestrator.run(turn)) as events:
        async for event in events:
            yield event.model_dump_json() + "\n"
