import { ApiError, Task, type DeviceSession, type GatewayEvent, type TaskControl, type TaskEvent } from "@venom/contracts";
import { v7 as uuidv7 } from "uuid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { actingDevice, type ActingDevice } from "./acting-device.ts";
import { call, createEnvironment, destroyEnvironment, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

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

async function account(speed: number): Promise<{ readonly here: DeviceSession; readonly device: ActingDevice }> {
  accounts += 1;
  const here = await signUpOverHttp(gateway.base, environment.mailer, `tasks-${accounts}@venom.test`, "tasks secret word");
  const device = await actingDevice(gateway.base, here, { speed });
  opened.push(device);
  return { here, device };
}

async function progressDrill(session: DeviceSession): Promise<Task> {
  const response = await call(gateway.base, "POST", "/v1/tasks/drill", { token: session.device_token, body: { kind: "progress" } });
  expect(response.status).toBe(201);
  return Task.parse(await response.json());
}

async function control(session: DeviceSession, taskId: string, body: TaskControl | Record<string, unknown>): Promise<Response> {
  return call(gateway.base, "POST", `/v1/tasks/${taskId}/control`, { token: session.device_token, body });
}

function taskEvent(taskId: string, match: (task: Task) => boolean) {
  return (event: GatewayEvent): event is TaskEvent => event.type === "task" && event.task.id === taskId && match(event.task);
}

function percentsSeen(device: ActingDevice, taskId: string): number[] {
  const seen = device.events.flatMap((event) => (event.type === "task" && event.task.id === taskId ? [event.task.progress.percent] : []));
  return seen.filter((percent, index) => index === 0 || percent !== seen[index - 1]);
}

describe("Definition of done: the progress drill moves exactly as the formula predicts", () => {
  it("counts done steps one at a time, and ignoring a step shrinks the total", async () => {
    const { here, device } = await account(10);
    const task = await progressDrill(here);
    expect(task.progress).toEqual({ done: 0, counted: 5, skipped: 0, ignored: 0, total: 5, percent: 0 });

    const ignoredStep = task.plan[4]?.id ?? "";
    const ignored = await control(here, task.id, { kind: "ignore", step_id: ignoredStep, reason: "Not needed today" });
    expect(ignored.status).toBe(200);
    expect(Task.parse(await ignored.json()).progress).toMatchObject({ counted: 4, ignored: 1 });

    const finished = await device.until(taskEvent(task.id, (current) => current.status === "completed"));
    expect(finished.type === "task" && finished.task.result).toBe("Finished. 4 steps done, 1 ignored.");
    expect(percentsSeen(device, task.id)).toEqual([0, 25, 50, 75, 100]);
    expect(device.reports.map((report) => report.stepId)).toEqual(task.plan.slice(0, 4).map((step) => step.id));
  });

  it("keeps a skipped step counted and runs it after the others", async () => {
    const { here, device } = await account(20);
    const task = await progressDrill(here);
    const second = task.plan[1]?.id ?? "";
    expect((await control(here, task.id, { kind: "skip", step_id: second, reason: "Come back to this later" })).status).toBe(200);

    await device.until(taskEvent(task.id, (current) => current.status === "completed"));
    const order = device.reports.map((report) => task.plan.findIndex((step) => step.id === report.stepId) + 1);
    expect(order).toEqual([1, 3, 4, 5, 2]);
    expect(percentsSeen(device, task.id)).toEqual([0, 20, 40, 60, 80, 100]);
  });
});

describe("controls are commands the cloud applies", () => {
  it("stops one task, then resumes it from the first unfinished step", async () => {
    const { here, device } = await account(4);
    const task = await progressDrill(here);
    await device.until(taskEvent(task.id, (current) => current.plan[1]?.status === "running"));
    const stopped = await call(gateway.base, "POST", "/v1/stop", { token: here.device_token, body: { stop_id: uuidv7(), scope: { kind: "task", task_id: task.id } } });
    expect(stopped.status).toBe(200);
    const record = await device.until(taskEvent(task.id, (current) => current.status === "stopped" && current.plan[1]?.status === "stopped"));
    expect(record.type === "task" && record.task.progress.percent).toBe(20);

    const resumed = await control(here, task.id, { kind: "resume" });
    expect(resumed.status).toBe(200);
    expect(Task.parse(await resumed.json()).plan.map((step) => step.status)).toEqual(["done", "pending", "pending", "pending", "pending"]);
    const finished = await device.until(taskEvent(task.id, (current) => current.status === "completed"));
    expect(finished.type === "task" && finished.task.progress.percent).toBe(100);
  }, 30_000);

  it("refuses to resume a task whose computer is not connected", async () => {
    const { here, device } = await account(4);
    const task = await progressDrill(here);
    await device.until(taskEvent(task.id, (current) => current.plan[0]?.status === "running"));
    await call(gateway.base, "POST", "/v1/stop", { token: here.device_token, body: { stop_id: uuidv7(), scope: { kind: "task", task_id: task.id } } });
    await device.until(taskEvent(task.id, (current) => current.plan[0]?.status === "stopped"));
    device.close();
    await device.closed;
    const refused = await control(here, task.id, { kind: "resume" });
    expect(refused.status).toBe(409);
    expect(ApiError.parse(await refused.json()).message).toBe("Work laptop is not connected, so it cannot take actions right now.");
  });

  it("refuses a skip or ignore without a reason, and a task that is not yours", async () => {
    const { here } = await account(20);
    const task = await progressDrill(here);
    const blank = await control(here, task.id, { kind: "ignore", step_id: task.plan[3]?.id ?? "", reason: "  " });
    expect(blank.status).toBe(400);
    const stranger = await account(20);
    const foreign = await control(stranger.here, task.id, { kind: "resume" });
    expect(foreign.status).toBe(404);
    expect(ApiError.parse(await foreign.json()).message).toBe("That task is not part of your VENOM.");
  });
});
