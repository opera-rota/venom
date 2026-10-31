import { ApiError, ConfirmationAnswered, StopReceipt, Task, type DeviceSession, type GatewayEvent, type TaskEvent } from "@venom/contracts";
import { newKeyPair } from "@venom/safety";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { scriptedBrain } from "../src/testing.ts";
import { actingDevice, enrollKey, liveHeaders, type ActingDevice } from "./acting-device.ts";
import { attachOverHttp, call, createEnvironment, destroyEnvironment, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let gateway: RunningGateway;
let accounts = 0;
const opened: ActingDevice[] = [];

beforeAll(async () => {
  environment = await createEnvironment();
  gateway = await startGateway(environment, { commandGraceMs: 2000 });
});

afterEach(() => {
  for (const device of opened.splice(0)) {
    device.close();
  }
});

afterAll(async () => {
  await gateway?.stop();
  await destroyEnvironment(environment);
});

async function account(): Promise<{ readonly email: string; readonly here: DeviceSession }> {
  accounts += 1;
  const email = `safety-${accounts}@venom.test`;
  return { email, here: await signUpOverHttp(gateway.base, environment.mailer, email, "safety secret word") };
}

async function acting(session: DeviceSession): Promise<ActingDevice> {
  const device = await actingDevice(gateway.base, session);
  opened.push(device);
  return device;
}

async function drill(session: DeviceSession, kind: "wait" | "sensitive"): Promise<Task> {
  const response = await call(gateway.base, "POST", "/v1/tasks/drill", { token: session.device_token, body: { kind } });
  expect(response.status).toBe(201);
  return Task.parse(await response.json());
}

function taskState(taskId: string, statuses: readonly string[]) {
  return (event: GatewayEvent): event is TaskEvent =>
    event.type === "task" && event.task.id === taskId && event.task.plan.map((step) => step.status).join() === statuses.join();
}

async function stop(session: DeviceSession, stopId = uuidv7()): Promise<StopReceipt> {
  const response = await call(gateway.base, "POST", "/v1/stop", { token: session.device_token, body: { stop_id: stopId, scope: { kind: "all" } } });
  expect(response.status).toBe(200);
  return StopReceipt.parse(await response.json());
}

describe("Definition of done: a thirty second step stops within a second", () => {
  it("halts the running step at once, keeps finished work and records what never started", async () => {
    const { here } = await account();
    const device = await acting(here);
    const task = await drill(here, "wait");
    const long = task.plan[1]?.id ?? "";

    await device.until(taskState(task.id, ["done", "running", "pending"]));
    const pressed = Date.now();
    const receipt = await stop(here);
    const halted = await device.reported(long);

    expect(halted.outcome).toBe("stopped");
    expect(halted.at - pressed).toBeLessThan(1000);
    expect(receipt.tasks.map((stopped) => stopped.id)).toEqual([task.id]);

    const record = await device.until(taskState(task.id, ["done", "stopped", "pending"]));
    expect(record.type === "task" && record.task).toMatchObject({
      status: "stopped",
      result: "Stopped. 1 finished, 1 stopped, 1 never started.",
    });
    expect(record.type === "task" && record.task.plan[1]?.output).toMatch(/^Stopped after \d+ of 30 seconds\.$/);
    expect(device.events.some((event) => event.type === "halt" && event.stop_id === receipt.stop_id)).toBe(true);
  });

  it("answers a repeated stop with the same record", async () => {
    const { here } = await account();
    await acting(here);
    const stopId = uuidv7();
    const first = await stop(here, stopId);
    const again = await stop(here, stopId);
    expect(again.stopped_at).toBe(first.stopped_at);
  });

  it("stops even while the brain is stuck in the middle of an answer", async () => {
    let release = () => {};
    const stuck = scriptedBrain(() => [{ hold: new Promise<void>((resolve) => (release = resolve)) }]);
    const isolated = await startGateway(environment, { brain: stuck });
    try {
      const here = await signUpOverHttp(isolated.base, environment.mailer, `stuck-${uuidv7()}@venom.test`, "safety secret word");
      expect((await call(isolated.base, "POST", "/v1/messages", { token: here.device_token, body: { text: "think forever" } })).status).toBe(202);
      const pressed = Date.now();
      const response = await call(isolated.base, "POST", "/v1/stop", { token: here.device_token, body: { stop_id: uuidv7(), scope: { kind: "all" } } });
      expect(response.status).toBe(200);
      expect(Date.now() - pressed).toBeLessThan(1000);
    } finally {
      release();
      await isolated.stop();
    }
  });
});

describe("Definition of done: a sensitive step pauses for confirmation", () => {
  it("pauses on every device, lets the first answer win, then runs the step", async () => {
    const { email, here } = await account();
    const there = await attachOverHttp(gateway.base, environment.mailer, email, "safety secret word");
    const device = await acting(here);
    const other = await acting(there);
    const task = await drill(here, "sensitive");
    const sensitive = task.plan[1];
    expect(sensitive).toMatchObject({ requires_confirmation: true, effects: ["deletes"], reversible: false });

    const asked = await other.until((event) => event.type === "confirmation" && event.answered === null);
    expect(asked.type === "confirmation" && asked.request).toMatchObject({ step_id: sensitive?.id, risk: "high", target_name: "Work laptop" });
    await device.until(taskState(task.id, ["done", "waiting", "pending"]));
    expect(device.reports.map((entry) => entry.stepId)).toEqual([task.plan[0]?.id]);

    const path = `/v1/tasks/${task.id}/steps/${sensitive?.id ?? ""}/confirmation`;
    const approved = await call(gateway.base, "POST", path, { token: there.device_token, body: { decision: "approve" } });
    expect(ConfirmationAnswered.parse(await approved.json())).toMatchObject({ outcome: "approved", device_name: "Second laptop" });
    const late = await call(gateway.base, "POST", path, { token: here.device_token, body: { decision: "decline" } });
    expect(late.status).toBe(409);
    expect(ApiError.parse(await late.json())).toEqual({ error: "already_answered", message: "This was already answered on Second laptop." });

    await device.until((event) => event.type === "confirmation" && event.answered?.outcome === "approved");
    await device.until(taskState(task.id, ["done", "running", "pending"]));
    await stop(here);
    await device.until(taskState(task.id, ["done", "stopped", "pending"]));
  });

  it("closes the open confirmation on every device when stopped", async () => {
    const { here } = await account();
    const device = await acting(here);
    const task = await drill(here, "sensitive");
    await device.until((event) => event.type === "confirmation" && event.answered === null);
    await stop(here);
    const closed = await device.until((event) => event.type === "confirmation" && event.answered !== null);
    expect(closed.type === "confirmation" && closed.answered?.outcome).toBe("stopped");
    const late = await call(gateway.base, "POST", `/v1/tasks/${task.id}/steps/${task.plan[1]?.id ?? ""}/confirmation`, {
      token: here.device_token,
      body: { decision: "approve" },
    });
    expect(late.status).toBe(409);
  });

  it("pauses on a step that cannot be undone only when the account is strict", async () => {
    const { here } = await account();
    await acting(here);
    expect((await drill(here, "wait")).plan.some((step) => step.requires_confirmation)).toBe(false);
    await stop(here);
    const changed = await call(gateway.base, "PUT", "/v1/settings/safety", { token: here.device_token, body: { confirmation_strictness: "strict" } });
    expect(await changed.json()).toEqual({ confirmation_strictness: "strict" });
    expect((await drill(here, "sensitive")).plan.map((step) => step.requires_confirmation)).toEqual([false, true, false]);
    await stop(here);
  });
});

describe("device trust", () => {
  it("refuses a drill on a device that has no key", async () => {
    const { here } = await account();
    const response = await call(gateway.base, "POST", "/v1/tasks/drill", { token: here.device_token, body: { kind: "wait" } });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error).toBe("device_key_missing");
  });

  it("refuses the live link of a keyed device that does not sign a fresh challenge, before it opens", async () => {
    const { here } = await account();
    const { pair } = await enrollKey(gateway.base, here);
    const live = `${gateway.base.replace("http", "ws")}/v1/live`;
    const attempt = (headers: Record<string, string>) =>
      new Promise<boolean>((resolve) => {
        const socket = new WebSocket(live, { headers });
        socket.addEventListener("open", () => {
          socket.close();
          resolve(true);
        });
        socket.addEventListener("error", () => resolve(false));
        socket.addEventListener("close", () => resolve(false));
      });

    expect(await attempt({ authorization: `Bearer ${here.device_token}` })).toBe(false);
    const headers = await liveHeaders(gateway.base, here, pair);
    expect(await attempt(headers)).toBe(true);
    expect(await attempt(headers)).toBe(false);
    expect(await attempt(await liveHeaders(gateway.base, here, newKeyPair()))).toBe(false);
  });

  it("refuses a report for a command the device was never sent", async () => {
    const { here } = await account();
    const response = await call(gateway.base, "POST", "/v1/commands/report", {
      token: here.device_token,
      body: { command_id: uuidv7(), outcome: "done", detail: null },
    });
    expect(response.status).toBe(404);
  });
});
