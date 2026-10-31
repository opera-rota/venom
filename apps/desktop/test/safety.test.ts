import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceSession, GatewayEvent, TaskEvent } from "@venom/contracts";
import { commandText, newKeyPair, signText } from "@venom/safety/device";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Api } from "../src/main/api.ts";
import { GatewayClient } from "../src/main/gateway-client.ts";
import { HaltController } from "../src/main/halt.ts";
import { Hands } from "../src/main/hands.ts";
import { SessionManager } from "../src/main/session-manager.ts";
import { CredentialVault } from "../src/main/vault.ts";
import type { HaltView } from "../src/shared/bridge.ts";
import { createAccount, createBackend, testEncryptor, type Backend } from "./support.ts";

let backend: Backend;
let port: number;
let accounts = 0;
const cleanups: (() => void)[] = [];

beforeAll(async () => {
  backend = await createBackend();
  port = await backend.start();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

afterAll(async () => {
  await backend?.destroy();
});

interface Symbiote {
  readonly sessions: SessionManager;
  readonly vault: CredentialVault;
  readonly gateway: GatewayClient;
  readonly hands: Hands;
  readonly halt: HaltController;
  readonly events: GatewayEvent[];
  readonly refusals: string[];
  until<T extends GatewayEvent>(match: (event: GatewayEvent) => event is T): Promise<T>;
  haltView(kind: HaltView["kind"]): Promise<HaltView>;
}

async function symbiote(session?: DeviceSession): Promise<Symbiote> {
  accounts += 1;
  const signedUp = session ?? (await createAccount(backend, `symbiote-${accounts}@venom.test`, "symbiote secret word"));
  const api = new Api(backend.url());
  const vault = new CredentialVault(join(mkdtempSync(join(tmpdir(), "venom-vault-")), "device-credential.bin"), testEncryptor);
  const sessions = new SessionManager({ api, vault });
  await sessions.signIn(signedUp);
  const gateway = new GatewayClient({
    api,
    retryBaseMs: 50,
    retryMaxMs: 200,
    trust: async () => {
      await sessions.ensureKeys();
      return sessions.trust;
    },
  });
  const refusals: string[] = [];
  const hands = new Hands({ trust: () => sessions.trust, report: (report) => gateway.report(report), refused: (reason) => refusals.push(reason) });
  const halt = new HaltController({ send: (stopId) => gateway.halt(stopId), haltLocally: () => hands.haltAll(), retryMs: 50, settleMs: 60_000 });
  const events: GatewayEvent[] = [];
  const waiters = new Set<() => void>();
  gateway.onEvent((event) => {
    events.push(event);
    for (const wake of [...waiters]) wake();
  });
  gateway.onCommand((frame) => hands.receive(frame));
  const token = sessions.token;
  if (token === null) {
    throw new Error("not signed in");
  }
  const online = new Promise<void>((resolve) => gateway.onState((state) => state === "online" && resolve()));
  gateway.start(token);
  await online;
  cleanups.push(() => {
    halt.close();
    hands.haltAll();
    gateway.stop();
  });

  return {
    sessions,
    vault,
    gateway,
    hands,
    halt,
    events,
    refusals,
    until: <T extends GatewayEvent>(match: (event: GatewayEvent) => event is T) =>
      new Promise<T>((resolve) => {
        const check = () => {
          const found = events.find(match);
          if (found !== undefined) {
            waiters.delete(check);
            resolve(found);
          }
        };
        waiters.add(check);
        check();
      }),
    haltView: (kind) =>
      new Promise((resolve) => {
        if (halt.view.kind === kind) {
          resolve(halt.view);
          return;
        }
        const stop = halt.onChange((view) => {
          if (view.kind === kind) {
            stop();
            resolve(view);
          }
        });
      }),
  };
}

function stepsAre(taskId: string, statuses: readonly string[]) {
  return (event: GatewayEvent): event is TaskEvent =>
    event.type === "task" && event.task.id === taskId && event.task.plan.map((step) => step.status).join() === statuses.join();
}

describe("the symbiote's device key", () => {
  it("is made on the device, enrolled once and kept only in the encrypted vault", async () => {
    const device = await symbiote();
    const stored = device.vault.read();
    expect(stored?.keys?.server_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored?.keys?.private_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await device.sessions.ensureKeys()).toBe(false);
  });
});

describe("the halt switch", () => {
  it("stops a thirty second step within a second and shows the record from the cloud", async () => {
    const device = await symbiote();
    const drilled = await device.gateway.drill("wait");
    if (!drilled.ok) {
      throw new Error(drilled.reason);
    }
    const { task } = drilled;
    await device.until(stepsAre(task.id, ["done", "running", "pending"]));
    expect(device.hands.busy).toBe(true);

    const pressed = Date.now();
    device.halt.press();
    expect(device.hands.busy).toBe(false);
    const stopped = await device.haltView("stopped");
    expect(Date.now() - pressed).toBeLessThan(1000);
    expect(stopped.kind === "stopped" && stopped.receipt.tasks.map((entry) => entry.id)).toEqual([task.id]);

    const record = await device.until(stepsAre(task.id, ["done", "stopped", "pending"]));
    expect(record.task.result).toBe("Stopped. 1 finished, 1 stopped, 1 never started.");
  });

  it("stops this computer at once when the gateway is unreachable, and tells the cloud when it is back", async () => {
    const device = await symbiote();
    await backend.stop();
    try {
      device.halt.press();
      await device.haltView("local");
    } finally {
      await backend.start(port);
    }
    await device.haltView("stopped");
  });
});

describe("refusals", () => {
  it("refuses a forged command and tells the cloud", async () => {
    const device = await symbiote();
    const trust = device.sessions.trust;
    if (trust === null) {
      throw new Error("no keys");
    }
    const payload = JSON.stringify({
      command_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e41",
      account_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01",
      device_id: trust.deviceId,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30_000).toISOString(),
      body: { kind: "run_step", task_id: trust.deviceId, step_id: trust.deviceId, action: { name: "wait", seconds: 5 } },
    });
    device.hands.receive({ type: "command", command: { payload, signature: signText(newKeyPair(), commandText(payload)) } });
    expect(device.hands.busy).toBe(false);
    expect(device.refusals).toEqual(["The command's signature did not match VENOM's key, so this device refused it."]);
  });

  it("keeps the device signed in when its live link is refused for a bad signature", async () => {
    const device = await symbiote();
    const token = device.sessions.token ?? "";
    const trust = device.sessions.trust;
    const impostor = new GatewayClient({
      api: new Api(backend.url()),
      retryBaseMs: 50,
      retryMaxMs: 100,
      trust: async () => (trust === null ? null : { ...trust, pair: newKeyPair() }),
    });
    let revoked = false;
    let online = false;
    impostor.onRevoked(() => (revoked = true));
    impostor.onState((state) => (online ||= state === "online"));
    impostor.start(token);
    await new Promise((resolve) => setTimeout(resolve, 400));
    impostor.stop();
    expect({ revoked, online }).toEqual({ revoked: false, online: false });
  });
});
