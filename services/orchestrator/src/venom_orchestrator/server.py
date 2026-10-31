import asyncio
import json
from collections.abc import AsyncGenerator, Callable, Coroutine
from contextlib import aclosing, asynccontextmanager, suppress

from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from venom_contracts.models import AvailableEngines, TurnRequest
from venom_orchestrator.turns import Orchestrator

NDJSON = "application/x-ndjson"

type Background = Callable[[], Coroutine[object, object, None]]


def create_app(orchestrator: Orchestrator, background: Background | None = None) -> Starlette:
    async def turns(request: Request) -> Response:
        try:
            turn = TurnRequest.model_validate_json(await request.body())
        except ValidationError as error:
            issues = json.loads(error.json(include_url=False, include_input=False, include_context=False))
            return JSONResponse({"error": "invalid_request", "issues": issues}, status_code=400)
        return StreamingResponse(lines(orchestrator, turn), media_type=NDJSON, headers={"cache-control": "no-store"})

    async def engines(_request: Request) -> Response:
        available = AvailableEngines(available=orchestrator.catalogue.available())
        return Response(available.model_dump_json(), media_type="application/json", headers={"cache-control": "no-store"})

    async def health(_request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncGenerator[None]:
        task = None if background is None else asyncio.create_task(background())
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    return Starlette(
        routes=[
            Route("/v1/turns", turns, methods=["POST"]),
            Route("/v1/engines", engines, methods=["GET"]),
            Route("/healthz", health, methods=["GET"]),
        ],
        lifespan=lifespan,
    )


async def lines(orchestrator: Orchestrator, turn: TurnRequest) -> AsyncGenerator[str]:
    async with aclosing(orchestrator.run(turn)) as events:
        async for event in events:
            yield event.model_dump_json() + "\n"
