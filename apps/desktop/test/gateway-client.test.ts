import type { DeviceSession, GatewayEvent } from "@venom/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Api } from "../src/main/api.ts";
import { GatewayClient, type Revocation } from "../src/main/gateway-client.ts";
import type { ConnectionState } from "../src/shared/bridge.ts";
import { createAccount, createBackend, expectOk, onboardingFor, type Backend } from "./support.ts";

let backend: Backend;
let port: number;
let session: DeviceSession;
const clients: GatewayClient[] = [];

function startClient(token: string, url = backend.url()): GatewayClient {
  const client = new GatewayClient({ api: new Api(url), retryBaseMs: 50, retryMaxMs: 200 });
  clients.push(client);
  client.start(token);
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

function revoked(target: GatewayClient): Promise<Revocation> {
  return new Promise((resolve) => {
    const stop = target.onRevoked((reason) => {
      stop();
      resolve(reason);
    });
  });
}

function record(target: GatewayClient) {
  const seen: GatewayEvent[] = [];
  const waiters = new Set<() => void>();
  target.onEvent((event) => {
    seen.push(event);
    for (const wake of waiters) wake();
  });

  return (requestId: string): Promise<GatewayEvent[]> =>
    new Promise((resolve) => {
      const check = () => {
        const mine = seen.filter((event) => event.request_id === requestId);
        if (mine.some((event) => event.type === "request" && event.state === "completed")) {
          waiters.delete(check);
          resolve(mine);
        }
      };
      waiters.add(check);
      check();
    });
}

beforeAll(async () => {
  backend = await createBackend();
  port = await backend.start();
  session = await createAccount(backend, "client@venom.test", "client secret word");
});

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.stop();
  }
});

afterAll(async () => {
  await backend?.destroy();
});

describe("gateway client in the main process", () => {
  it("sends a message with the device token and receives the tagged echo", async () => {
    const client = startClient(session.device_token);
    const settled = record(client);
    await nextState(client, "online");

    const result = await client.send("Hello from the desktop");
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const events = await settled(result.requestId);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect((await client.history()).at(-1)).toMatchObject({ speaker: "venom", text: "Hello from the desktop" });
  });

  it("lists the devices of the account", async () => {
    const client = startClient(session.device_token);
    const result = await client.devices();
    expect(result.ok && result.list.current_device_id).toBe(session.device.id);
  });

  it("refuses to send nothing", async () => {
    const client = startClient(session.device_token);
    expect(await client.send("   ")).toMatchObject({ ok: false, reason: "Write something before sending." });
  });

  it("keeps retrying when the app opens before the gateway is running, then connects", async () => {
    await backend.stop();
    const client = startClient(session.device_token);
    await nextState(client, "offline");
    await backend.start(port);
    await nextState(client, "online");
  });

  it("signs the device out when another device removes it", async () => {
    const { onboarding, sessions } = onboardingFor(backend.url(), "Spare laptop");
    await expectOk(onboarding.startAttach("client@venom.test", "client secret word"));
    await expectOk(onboarding.confirmAttach(backend.mailer.lastCodeFor("client@venom.test")));
    const spare = sessions[0];
    if (spare === undefined) {
      throw new Error("attach did not complete");
    }

    const victim = startClient(spare.device_token);
    await nextState(victim, "online");
    const signal = revoked(victim);

    const owner = startClient(session.device_token);
    await expectOk(owner.removeDevice(spare.device.id));
    expect(await signal).toBe("removed");
    expect(victim.running).toBe(false);
  });

  it("treats an unknown token as signed out instead of retrying forever", async () => {
    const client = startClient(`vnm_${"A".repeat(43)}`);
    expect(await revoked(client)).toBe("unauthorized");
    expect(client.state).toBe("offline");
  });
});
