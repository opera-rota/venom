import { HowTo, HowToList, Observation, type DeviceSession, type GatewayEvent, type NextMove, type TaskEvent } from "@venom/contracts";
import { encode } from "jpeg-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { howToWords } from "../src/routes/howtos.ts";
import { handToLoop, movesWith } from "../src/testing.ts";
import { actingDevice, type ActingDevice } from "./acting-device.ts";
import { call, createEnvironment, destroyEnvironment, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let gateway: RunningGateway;
let here: DeviceSession;
let stranger: DeviceSession;
let near: ActingDevice;

const width = 64;
const height = 40;
const picture = encode({ data: Buffer.alloc(width * height * 4, 90), width, height }, 80).data.toString("base64");

const opening: NextMove = { seen: "The desktop is showing.", next: { kind: "move", intent: "Open the Calculator app.", effects: [], move: { name: "open", app: "Calculator", open: null } } };
const typing: NextMove = { seen: "Calculator is open.", next: { kind: "move", intent: "Type the sum.", effects: [], move: { name: "type", text: "1+2+3", mark: null, enter: false } } };
const pressing: NextMove = { seen: "The sum is typed.", next: { kind: "move", intent: "Press Enter to see the total.", effects: [], move: { name: "key", key: "enter" } } };
const finished: NextMove = { seen: "The total is 6.", next: { kind: "done", answer: "The total is 6." } };

beforeAll(async () => {
  environment = await createEnvironment();
  gateway = await startGateway(environment, { commandGraceMs: 2000, loopLimits: { retryMs: 10 } });
  gateway.brain.script = handToLoop;
  here = await signUpOverHttp(gateway.base, environment.mailer, "howtos@venom.test", "howtos secret word");
  stranger = await signUpOverHttp(gateway.base, environment.mailer, "howtos-stranger@venom.test", "stranger secret word");
  const response = await call(gateway.base, "PUT", "/v1/devices/current/capabilities", {
    token: here.device_token,
    body: { device_id: here.device.id, capabilities: { ...here.device.capabilities, screen_control: true } },
  });
  expect(response.status).toBe(200);
  near = await actingDevice(gateway.base, here, {
    screen: { look: () => Observation.parse({ picture, width, height, window: "Calculator", app: "Calculator", marks: [], focused: null }) },
  });
});

afterAll(async () => {
  near?.close();
  await gateway?.stop();
  await destroyEnvironment(environment);
});

function completedGoal(event: GatewayEvent): event is TaskEvent {
  return event.type === "task" && event.task.kind === "goal" && event.task.status === "completed";
}

async function listed(token: string): Promise<HowToList> {
  return HowToList.parse(await (await call(gateway.base, "GET", "/v1/howtos", { token })).json());
}

describe("how-tos: VENOM keeps the way it did a job", () => {
  it("saves a finished job as a named how-to with its steps, tells every window, and only once", async () => {
    gateway.brain.mover = movesWith([opening, typing, pressing, finished]);
    const sent = await call(gateway.base, "POST", "/v1/messages", { token: here.device_token, body: { text: "Open Calculator and add 1+2+3." } });
    expect(sent.status).toBe(202);
    const done = (await near.until(completedGoal)) as TaskEvent;

    expect((await call(gateway.base, "POST", "/v1/howtos", { token: stranger.device_token, body: { task_id: done.task.id } })).status).toBe(404);

    const saved = await call(gateway.base, "POST", "/v1/howtos", { token: here.device_token, body: { task_id: done.task.id } });
    expect(saved.status).toBe(201);
    const howto = HowTo.parse(await saved.json());
    expect(howto).toMatchObject({ name: "Open Calculator and add 1+2+3", app: "Calculator", learned: "job", task_id: done.task.id, applied: 0, pinned: false });
    expect(howto.steps.map((step) => [step.number, step.kind, step.label, step.said, step.note])).toEqual([
      [1, "open", "Calculator", "Open the Calculator app.", null],
      [2, "type", "“1+2+3”", "Type the sum.", null],
      [3, "key", "Enter", "Press Enter to see the total.", null],
    ]);
    await near.until((event) => event.type === "howto" && event.howto.id === howto.id);

    const again = await call(gateway.base, "POST", "/v1/howtos", { token: here.device_token, body: { task_id: done.task.id } });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { message: string }).message).toBe(howToWords.exists);
    expect((await listed(here.device_token)).howtos.map((item) => item.id)).toEqual([howto.id]);
    expect((await listed(stranger.device_token)).howtos).toEqual([]);
  });

  it("renames, pins and notes a step, and forgets it for good, only for its own account", async () => {
    const [howto] = (await listed(here.device_token)).howtos;
    const id = howto?.id ?? "";

    expect((await call(gateway.base, "PATCH", `/v1/howtos/${id}`, { token: stranger.device_token, body: { pinned: true } })).status).toBe(404);
    expect((await call(gateway.base, "PATCH", `/v1/howtos/${id}`, { token: here.device_token, body: {} })).status).toBe(400);

    const renamed = HowTo.parse(await (await call(gateway.base, "PATCH", `/v1/howtos/${id}`, { token: here.device_token, body: { name: "Add numbers", pinned: true } })).json());
    expect(renamed).toMatchObject({ name: "Add numbers", pinned: true });

    const noted = await call(gateway.base, "PUT", `/v1/howtos/${id}/steps/2/note`, { token: here.device_token, body: { note: "Use the keyboard, not the buttons." } });
    expect(noted.status).toBe(200);
    expect(HowTo.parse(await noted.json()).steps.map((step) => step.note)).toEqual([null, "Use the keyboard, not the buttons.", null]);
    expect((await call(gateway.base, "PUT", `/v1/howtos/${id}/steps/9/note`, { token: here.device_token, body: { note: "x" } })).status).toBe(404);
    expect((await call(gateway.base, "PUT", `/v1/howtos/${id}/steps/2/note`, { token: here.device_token, body: { note: "  " } })).status).toBe(400);

    const forgotten = await call(gateway.base, "DELETE", `/v1/howtos/${id}`, { token: here.device_token });
    expect(forgotten.status).toBe(204);
    await near.until((event) => event.type === "howto_removed" && event.howto_id === id);
    await near.until((event) => event.type === "howto" && event.howto.id === id && event.howto.steps[1]?.note !== null);
    expect((await listed(here.device_token)).howtos).toEqual([]);
    expect((await call(gateway.base, "DELETE", `/v1/howtos/${id}`, { token: here.device_token })).status).toBe(404);
  });

  it("refuses a job that is gone or still going, in plain words", async () => {
    const missing = await call(gateway.base, "POST", "/v1/howtos", { token: here.device_token, body: { task_id: "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e00" } });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { message: string }).message).toBe(howToWords.jobGone);
  });
});
