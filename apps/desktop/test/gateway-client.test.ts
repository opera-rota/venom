import type { GatewayEvent } from "@venom/contracts";
import { connect, createStore, developmentDevice, seedDevelopment, type Store } from "@venom/db";
import { createTestDatabase, type TestDatabase } from "@venom/db/testing";
import { buildGateway } from "@venom/gateway";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { ConnectionState } from "../src/shared/bridge.ts";
import { GatewayClient } from "../src/main/gateway-client.ts";

let database: TestDatabase;
let store: Store;
let gateway: FastifyInstance | null = null;
let client: GatewayClient | null = null;

async function startGateway(port = 0): Promise<number> {
  gateway = await buildGateway({ store, logger: false });
  await gateway.listen({ host: "127.0.0.1", port });
  const address = gateway.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Gateway has no port");
  }
  return address.port;
}

async function stopGateway(): Promise<void> {
  await gateway?.close();
  gateway = null;
}

function startClient(port: number, deviceId: string = developmentDevice.id): GatewayClient {
  client = new GatewayClient({ gatewayUrl: `http://127.0.0.1:${port}`, deviceId, retryBaseMs: 50, retryMaxMs: 200 });
  client.start();
  return client;
}

function nextState(target: GatewayClient, wanted: ConnectionState): Promise<void> {
  if (target.state === wanted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const stop = target.onState((state) => {
      if (state === wanted) {
        stop();
        resolve();
      }
    });
  });
}

function settled(target: GatewayClient, requestId: string): Promise<GatewayEvent[]> {
  const seen: GatewayEvent[] = [];
  return new Promise((resolve) => {
    const stop = target.onEvent((event) => {
      if (event.request_id !== requestId) {
        return;
      }
      seen.push(event);
      if (event.type === "request" && event.state === "completed") {
        stop();
        resolve(seen);
      }
    });
  });
}

beforeAll(async () => {
  database = await createTestDatabase();
  const owner = connect(database.migratorUrl, { max: 1 });
  await seedDevelopment(owner);
  await owner.end();
  store = createStore(database.appUrl);
});

afterEach(async () => {
  client?.stop();
  client = null;
  await stopGateway();
});

afterAll(async () => {
  await store?.close();
  await database?.drop();
});

describe("desktop gateway client", () => {
  it("connects, sends, and receives its own tagged events", async () => {
    const port = await startGateway();
    const venom = startClient(port);
    await nextState(venom, "online");

    const pending: GatewayEvent[] = [];
    const stop = venom.onEvent((event) => pending.push(event));
    const result = await venom.send("Hello from the desktop");
    stop();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const events = [...pending.filter((e) => e.request_id === result.requestId), ...(await settled(venom, result.requestId))];
    const texts = events.flatMap((event) => (event.type === "message" ? [`${event.message.speaker}:${event.message.text}`] : []));
    expect(texts).toEqual(["user:Hello from the desktop", "venom:Hello from the desktop"]);

    const history = await venom.history();
    expect(history.at(-1)?.text).toBe("Hello from the desktop");
  });

  it("refuses blank messages before they leave the computer", async () => {
    const port = await startGateway();
    const venom = startClient(port);
    expect(await venom.send("   ")).toEqual({ ok: false, reason: "Write something before sending." });
  });

  it("says plainly when the gateway is down, then reconnects by itself", async () => {
    const port = await startGateway();
    const venom = startClient(port);
    await nextState(venom, "online");

    await stopGateway();
    await nextState(venom, "offline");
    expect(await venom.send("anyone there?")).toMatchObject({ ok: false });

    await startGateway(port);
    await nextState(venom, "online");
    expect((await venom.send("back again")).ok).toBe(true);
  });

  it("keeps retrying when the app opens before the gateway is running", async () => {
    const port = await startGateway();
    await stopGateway();

    const venom = startClient(port);
    await nextState(venom, "offline");
    await new Promise((resolve) => setTimeout(resolve, 300));

    await startGateway(port);
    await nextState(venom, "online");
    expect((await venom.send("you came back")).ok).toBe(true);
  });

  it("stops retrying for a device the gateway does not know", async () => {
    const port = await startGateway();
    const venom = startClient(port, uuidv7());
    await nextState(venom, "offline");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(venom.state).toBe("offline");
  });
});
