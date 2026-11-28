import { Observation, type DeviceSession, type GatewayEvent, type MessageEvent, type NextMove, type RemoteAction, type RemoteEvent, type TaskEvent } from "@venom/contracts";
import { encode } from "jpeg-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { remoteWords } from "../src/routes/remote.ts";
import { handToLoop, movesWith } from "../src/testing.ts";
import { actingDevice, type ActingDevice } from "./acting-device.ts";
import { attachOverHttp, call, createEnvironment, destroyEnvironment, openLive, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let gateway: RunningGateway;
let accounts = 0;
const opened: ActingDevice[] = [];
const sockets: WebSocket[] = [];

const picture = encode({ data: Buffer.alloc(64 * 40 * 4, 90), width: 64, height: 40 }, 80).data.toString("base64");
const notepad = { look: () => Observation.parse({ picture, width: 64, height: 40, window: "Untitled - Notepad", app: "Notepad", marks: [], focused: null }) };
const waiting: NextMove = { seen: "Notepad is opening.", next: { kind: "move", intent: "Wait for Notepad", effects: [], move: { name: "pause", seconds: 1 } } };
const typing: NextMove = { seen: "Notepad is open.", next: { kind: "move", intent: "Type the list", effects: [], move: { name: "type", text: "Milk, bread, eggs", mark: null, enter: false } } };
const finished: NextMove = { seen: "The list is in Notepad.", next: { kind: "done", answer: "Your shopping list is in Notepad." } };

interface Pair {
  readonly laptop: DeviceSession;
  readonly phone: DeviceSession;
  readonly near: ActingDevice;
  readonly live: ReturnType<typeof openLive>;
}

beforeAll(async () => {
  environment = await createEnvironment();
  gateway = await startGateway(environment, { commandGraceMs: 2000, loopLimits: { retryMs: 10 } });
  gateway.brain.script = handToLoop;
});

afterEach(() => {
  for (const device of opened.splice(0)) {
    device.close();
  }
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
});

afterAll(async () => {
  await gateway?.stop();
  await destroyEnvironment(environment);
});

async function pair(inUse = true): Promise<Pair> {
  accounts += 1;
  const email = `remote-${accounts}@venom.test`;
  const laptop = await signUpOverHttp(gateway.base, environment.mailer, email, "remote secret word");
  const capable = await call(gateway.base, "PUT", "/v1/devices/current/capabilities", {
    token: laptop.device_token,
    body: { device_id: laptop.device.id, capabilities: { ...laptop.device.capabilities, screen_control: true } },
  });
  expect(capable.status).toBe(200);
  const near = await actingDevice(gateway.base, laptop, { screen: notepad });
  opened.push(near);
  const phone = await attachOverHttp(gateway.base, environment.mailer, email, "remote secret word");
  const live = openLive(gateway.base, phone.device_token);
  sockets.push(live.socket);
  await live.opened;
  if (inUse) {
    expect((await call(gateway.base, "POST", `/v1/devices/${laptop.device.id}/use`, { token: phone.device_token })).status).toBe(200);
  }
  return { laptop, phone, near, live };
}

function act(session: DeviceSession, deviceId: string, action: unknown): Promise<Response> {
  return call(gateway.base, "POST", "/v1/remote/action", { token: session.device_token, body: { device_id: deviceId, action } });
}

function session(from: DeviceSession, deviceId: string, on: boolean): Promise<Response> {
  return call(gateway.base, "POST", "/v1/remote/session", { token: from.device_token, body: { device_id: deviceId, on } });
}

function remote(on: boolean) {
  return (event: GatewayEvent): event is RemoteEvent => event.type === "remote" && event.on === on;
}

async function refusal(response: Response): Promise<string> {
  expect(response.status).toBe(409);
  return ((await response.json()) as { message: string }).message;
}

describe("Remote: her touches go straight to the computer in use", () => {
  it("sends taps, typing, keys and scrolls to the computer in use, signed, from her device, with no thinking", async () => {
    const { laptop, phone, near } = await pair();
    const thought = gateway.brain.moves.length;
    const actions: RemoteAction[] = [
      { kind: "click", spot: { x: 0.55, y: 0.62 } },
      { kind: "double", spot: { x: 0.1, y: 0.2 } },
      { kind: "right", spot: { x: 0.9, y: 0.9 } },
      { kind: "type", text: "1+2+3=" },
      { kind: "key", key: "enter" },
      { kind: "scroll", spot: { x: 0.5, y: 0.5 }, direction: "down", steps: 3 },
    ];
    for (const action of actions) {
      expect((await act(phone, laptop.device.id, action)).status).toBe(202);
    }
    await near.until(() => near.remotes.length === actions.length);
    expect(near.remotes.map((command) => [command.from_device_id, command.action])).toEqual(actions.map((action) => [phone.device.id, action]));
    expect(gateway.brain.moves.length).toBe(thought);
  });

  it("refuses itself, a computer not in use, another account, and a touch outside the screen", async () => {
    const { laptop, phone } = await pair(false);
    const click = { kind: "click", spot: { x: 0.5, y: 0.5 } };
    expect(await refusal(await act(phone, laptop.device.id, click))).toBe(remoteWords.notReady);
    expect((await call(gateway.base, "POST", `/v1/devices/${laptop.device.id}/use`, { token: phone.device_token })).status).toBe(200);
    expect(await refusal(await act(laptop, laptop.device.id, click))).toBe(remoteWords.notReady);
    expect(await refusal(await session(phone, phone.device.id, true))).toBe(remoteWords.notReady);
    const stranger = await pair();
    expect(await refusal(await act(stranger.phone, laptop.device.id, click))).toBe(remoteWords.notReady);
    expect((await act(phone, laptop.device.id, { kind: "click", spot: { x: 1.4, y: 0.5 } })).status).toBe(400);
    expect((await act(phone, laptop.device.id, { kind: "key", key: "ctrl+alt+delete" })).status).toBe(400);
    expect((await act(phone, laptop.device.id, click)).status).toBe(202);
  });

  it("pauses a running job when she takes the remote, tells every device, and carries on after continue", async () => {
    const { laptop, phone, near, live } = await pair();
    gateway.brain.mover = movesWith([waiting, typing, finished]);
    expect((await call(gateway.base, "POST", "/v1/messages", { token: phone.device_token, body: { text: "Write a shopping list in Notepad" } })).status).toBe(202);
    await near.until(() => near.moves.length === 1);

    expect((await session(phone, laptop.device.id, true)).status).toBe(204);
    const shown = await near.until(remote(true));
    expect(shown).toMatchObject({ from_device_id: phone.device.id, to_device_id: laptop.device.id });
    await live.until(remote(true));
    await near.until((event): event is MessageEvent => event.type === "message" && event.message.speaker === "venom" && event.message.text.startsWith("Ooh, you go first, buddy."));
    await near.until((event): event is TaskEvent => event.type === "task" && event.task.kind === "goal" && event.task.status === "awaiting_confirmation");
    expect(near.moves).toHaveLength(1);

    expect((await act(phone, laptop.device.id, { kind: "type", text: "hello" })).status).toBe(202);
    await near.until(() => near.remotes.length === 1);
    expect((await call(gateway.base, "POST", "/v1/messages", { token: phone.device_token, body: { text: "continue" } })).status).toBe(202);
    await near.until((event): event is TaskEvent => event.type === "task" && event.task.kind === "goal" && event.task.status === "completed");
    expect(near.moves.map((command) => command.move.name)).toEqual(["pause", "type"]);

    expect((await session(phone, laptop.device.id, false)).status).toBe(204);
    await near.until(remote(false));
  });
});
