import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { TurnEvent, TurnRequest } from "@venom/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { BrainError, createBrainClient } from "../src/brain.ts";

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void;

const turn: TurnRequest = {
  request_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
  account_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02",
  device_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03",
  engine: "dove",
  history: [],
  text: "Explain what a mutex is",
};

const usage = { input_tokens: 40, output_tokens: 9, cost_micro_usd: 310 };

let server: Server | null = null;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server === null ? resolve() : server.close(() => resolve())));
  server = null;
});

async function serve(handler: Handler): Promise<string> {
  server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => handler(request, response, body));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function collect(url: string, options: { idleMs?: number; signal?: AbortSignal } = {}): Promise<TurnEvent[]> {
  const brain = createBrainClient({ url, ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }) });
  const events: TurnEvent[] = [];
  for await (const event of brain.turn(turn, options.signal ?? new AbortController().signal)) {
    events.push(event);
  }
  return events;
}

async function problemOf(work: Promise<unknown>): Promise<string> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BrainError);
  return (error as BrainError).problem;
}

const line = (event: TurnEvent) => `${JSON.stringify(event)}\n`;

describe("brain client", () => {
  it("posts the turn and reads events split across chunks", async () => {
    let received = "";
    const url = await serve((request, response, body) => {
      received = `${request.method} ${request.url} ${body}`;
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      const text = line({ type: "delta", text: "A mutex " }) + line({ type: "done", intent: "question", text: "A mutex is a lock.", model: "m", usage });
      response.write(text.slice(0, 11));
      setTimeout(() => response.end(text.slice(11)), 20);
    });

    const events = await collect(url);
    expect(events).toEqual([
      { type: "delta", text: "A mutex " },
      { type: "done", intent: "question", text: "A mutex is a lock.", model: "m", usage },
    ]);
    expect(received).toBe(`POST /v1/turns ${JSON.stringify(turn)}`);
  });

  it("gives up when the brain goes quiet", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.write(line({ type: "delta", text: "Thinking" }));
    });
    expect(await problemOf(collect(url, { idleMs: 150 }))).toBe("timeout");
  });

  it("reports a brain that refuses the turn", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid_request"}');
    });
    expect(await problemOf(collect(url))).toBe("refused");
  });

  it("reports a line that is not a turn event", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200).end('{"type":"done","intent":"chat"}\n');
    });
    expect(await problemOf(collect(url))).toBe("malformed");
  });

  it("reports a brain that is not running", async () => {
    const url = await serve(() => {});
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    expect(await problemOf(collect(url))).toBe("unreachable");
  });

  it("asks the brain which engines can answer right now", async () => {
    const url = await serve((request, response) => {
      response.writeHead(request.url === "/v1/engines" ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify({ available: ["dove", "titan"] }));
    });
    expect(await createBrainClient({ url }).engines()).toEqual(["dove", "titan"]);
  });

  it("reports a brain that cannot list its engines", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(503);
      response.end();
    });
    await expect(createBrainClient({ url }).engines()).rejects.toMatchObject({ problem: "refused" });
  });

  it("stops when the gateway asks it to", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.write(line({ type: "delta", text: "Thinking" }));
    });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    expect(await problemOf(collect(url, { signal: stop.signal }))).toBe("stopped");
  });
});
