import { GatewayEvent, MessageHistory, SendMessageAccepted } from "@venom/contracts";
import { connect, createStore, developmentAccount, developmentDevice, seedDevelopment, type Store } from "@venom/db";
import { createTestDatabase, type TestDatabase } from "@venom/db/testing";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGateway, closeCodes } from "../src/app.ts";

let database: TestDatabase;

async function startGateway(): Promise<{ app: FastifyInstance; store: Store; base: string }> {
  const store = createStore(database.appUrl);
  const app = await buildGateway({ store, logger: false });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, store, base: address };
}

async function stopGateway({ app, store }: { app: FastifyInstance; store: Store }): Promise<void> {
  await app.close();
  await store.close();
}

function openLive(base: string, deviceId: string) {
  const socket = new WebSocket(`${base.replace("http", "ws")}/v1/live?device_id=${deviceId}`);
  const events: GatewayEvent[] = [];
  const waiters = new Set<() => void>();

  socket.addEventListener("message", ({ data }) => {
    events.push(GatewayEvent.parse(JSON.parse(String(data))));
    for (const wake of waiters) wake();
  });

  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("live connection failed")), { once: true });
  });

  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", ({ code }) => resolve(code), { once: true });
  });

  function settled(requestId: string): Promise<GatewayEvent[]> {
    return new Promise((resolve) => {
      const check = () => {
        const mine = events.filter((event) => event.request_id === requestId);
        if (mine.some((event) => event.type === "request" && event.state !== "accepted")) {
          waiters.delete(check);
          resolve(mine);
        }
      };
      waiters.add(check);
      check();
    });
  }

  return { socket, opened, closed, settled };
}

async function send(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  database = await createTestDatabase();
  const owner = connect(database.migratorUrl, { max: 1 });
  await seedDevelopment(owner);
  await owner.end();
});

afterAll(async () => {
  await database?.drop();
});

describe("walking skeleton: symbiote to gateway to database and back", () => {
  it("saves a message, streams tagged events in order, and keeps it after a restart", async () => {
    const gateway = await startGateway();
    const live = openLive(gateway.base, developmentDevice.id);
    await live.opened;

    const response = await send(gateway.base, { device_id: developmentDevice.id, text: "Hello VENOM" });
    expect(response.status).toBe(202);
    const { request_id } = SendMessageAccepted.parse(await response.json());

    const events = await live.settled(request_id);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(events.map((event) => (event.type === "message" ? `message:${event.message.speaker}` : `request:${event.state}`))).toEqual([
      "request:accepted",
      "message:user",
      "message:venom",
      "request:completed",
    ]);
    expect(events.every((event) => event.request_id === request_id)).toBe(true);

    live.socket.close();
    await stopGateway(gateway);

    const restarted = await startGateway();
    const history = MessageHistory.parse(
      await (await fetch(`${restarted.base}/v1/messages?device_id=${developmentDevice.id}`)).json(),
    );
    expect(history.messages.slice(-2).map((message) => [message.speaker, message.text])).toEqual([
      ["user", "Hello VENOM"],
      ["venom", "Hello VENOM"],
    ]);
    expect(history.messages.every((message) => message.account_id === developmentAccount.id)).toBe(true);
    await stopGateway(restarted);
  });

  it("keeps concurrent requests apart by request id", async () => {
    const gateway = await startGateway();
    const live = openLive(gateway.base, developmentDevice.id);
    await live.opened;

    const responses = await Promise.all(
      ["one", "two", "three"].map((text) => send(gateway.base, { device_id: developmentDevice.id, text })),
    );
    const ids = await Promise.all(responses.map(async (r) => SendMessageAccepted.parse(await r.json()).request_id));
    const streams = await Promise.all(ids.map((id) => live.settled(id)));

    expect(new Set(ids).size).toBe(3);
    streams.forEach((stream, index) => {
      expect(stream.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
      const texts = stream.flatMap((event) => (event.type === "message" ? [event.message.text] : []));
      expect(texts).toEqual([["one", "two", "three"][index], ["one", "two", "three"][index]]);
    });

    live.socket.close();
    await stopGateway(gateway);
  });

  it("refuses bad input with clear errors", async () => {
    const gateway = await startGateway();

    expect((await send(gateway.base, { device_id: developmentDevice.id, text: "   " })).status).toBe(400);
    expect((await send(gateway.base, { device_id: developmentDevice.id, text: "hi", extra: true })).status).toBe(400);
    expect((await send(gateway.base, { device_id: "not-a-uuid", text: "hi" })).status).toBe(400);

    const unknown = await send(gateway.base, { device_id: uuidv7(), text: "hi" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "unknown_device" });

    const broken = await fetch(`${gateway.base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(broken.status).toBe(400);

    await stopGateway(gateway);
  });

  it("closes live connections for unknown devices", async () => {
    const gateway = await startGateway();
    const live = openLive(gateway.base, uuidv7());
    expect(await live.closed).toBe(closeCodes.unknownDevice);
    await stopGateway(gateway);
  });

  it("reports health from the database", async () => {
    const gateway = await startGateway();
    const response = await fetch(`${gateway.base}/healthz`);
    expect(await response.json()).toEqual({ status: "ok" });
    await stopGateway(gateway);
  });
});
