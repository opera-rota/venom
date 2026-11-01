import { ApiError, MessageHistory, SafetySettings, Task, type DeviceSession, type GatewayEvent, type MessageEvent, type PlanDraft, type TaskEvent } from "@venom/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { planWith } from "../src/testing.ts";
import { actingDevice, type ActingDevice } from "./acting-device.ts";
import { attachOverHttp, call, createEnvironment, destroyEnvironment, signUpOverHttp, startGateway, type Environment, type RunningGateway } from "./harness.ts";

let environment: Environment;
let gateway: RunningGateway;
let accounts = 0;
const opened: ActingDevice[] = [];

const secretWord = "plans secret word";

const shoppingList: PlanDraft = {
  title: "Shopping list on the desktop",
  steps: [
    { summary: "Open Notepad", spec: { name: "open_app", app: "Notepad" }, effects: [], reversible: true },
    { summary: "Type the shopping list", spec: { name: "type_text", text: "Milk, bread, eggs", into: "the Notepad window" }, effects: [], reversible: true },
    { summary: "Delete last week's list", spec: { name: "click", on: "the Delete button" }, effects: ["deletes"], reversible: false },
  ],
  cannot: null,
};

beforeAll(async () => {
  environment = await createEnvironment();
  gateway = await startGateway(environment);
});

afterEach(() => {
  gateway.brain.script = planWith(shoppingList);
  for (const device of opened.splice(0)) {
    device.close();
  }
});

afterAll(async () => {
  await gateway?.stop();
  await destroyEnvironment(environment);
});

async function account(): Promise<{ readonly here: DeviceSession; readonly there: DeviceSession; readonly near: ActingDevice; readonly far: ActingDevice }> {
  accounts += 1;
  const email = `plans-${accounts}@venom.test`;
  const here = await signUpOverHttp(gateway.base, environment.mailer, email, secretWord);
  const there = await attachOverHttp(gateway.base, environment.mailer, email, secretWord);
  const near = await actingDevice(gateway.base, here);
  const far = await actingDevice(gateway.base, there);
  opened.push(near, far);
  return { here, there, near, far };
}

async function ask(session: DeviceSession, text: string): Promise<void> {
  const response = await call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text } });
  expect(response.status).toBe(202);
}

function reply(event: GatewayEvent): event is MessageEvent {
  return event.type === "message" && event.message.speaker === "venom";
}

function planned(event: GatewayEvent): event is TaskEvent {
  return event.type === "task" && event.task.status === "planned";
}

describe("Definition of done: a request becomes a plan that is shown and never run", () => {
  it("plans one sentence into steps, marks the ones that ask, shows it on every device and runs nothing", async () => {
    gateway.brain.script = planWith(shoppingList);
    const { here, near, far } = await account();
    await ask(here, "Write my shopping list in Notepad and clear last week's");

    const { task } = (await far.until(planned)) as TaskEvent;
    const { message } = (await far.until(reply)) as MessageEvent;
    expect(message.task_id).toBe(task.id);
    expect(message.text).toBe(
      `Here is my plan: Shopping list on the desktop. It has 3 steps, and I would ask you before 1 of them. ${here.device.name} cannot control its screen yet, so this plan cannot run there yet. I cannot run steps yet, so nothing has been done.`,
    );
    expect(task.request_text).toBe("Write my shopping list in Notepad and clear last week's");
    expect(task.target_device_id).toBe(here.device.id);
    expect(task.plan.map((step) => [step.action, step.status, step.requires_confirmation, step.reversible])).toEqual([
      ["open_app", "pending", false, true],
      ["type_text", "pending", false, true],
      ["click", "pending", true, false],
    ]);
    expect(task.plan[2]?.effects).toEqual(["deletes"]);

    await near.until(planned);
    expect([...near.reports, ...far.reports]).toEqual([]);
    expect(gateway.brain.requests.at(-1)?.connectors).toEqual([]);

    const history = MessageHistory.parse(await (await call(gateway.base, "GET", "/v1/messages", { token: here.device_token })).json());
    expect(history.messages.at(-1)?.task_id).toBe(task.id);
    const listed = await (await call(gateway.base, "GET", "/v1/tasks", { token: here.device_token })).json();
    expect(listed).toMatchObject({ tasks: [{ id: task.id, status: "planned" }] });
  });

  it("says plainly that a broken plan was thrown away, and saves no task", async () => {
    gateway.brain.script = planWith(null);
    const { here, near } = await account();
    await ask(here, "Clean up my computer");

    const { message } = (await near.until(reply)) as MessageEvent;
    expect([message.text, message.task_id]).toEqual(["My plan came back broken. Nothing was done.", null]);
    expect(near.events.some((event) => event.type === "task")).toBe(false);
  });

  it("refuses a plan that needs a service VENOM is not connected to, in plain words", async () => {
    gateway.brain.script = planWith({
      title: "Email the list",
      steps: [{ summary: "Email the list to Alex", spec: { name: "call_connector", service: "mail", operation: "send an email", details: "To Alex" }, effects: [], reversible: true }],
      cannot: null,
    });
    const { here, near } = await account();
    await ask(here, "Email my shopping list to Alex");

    const { message } = (await near.until(reply)) as MessageEvent;
    expect(message.text).toBe("This needs Mail connected to VENOM, and connecting services is not possible yet. Nothing was done.");
    expect(message.task_id).toBeNull();
  });

  it("discards a plan from any device, and refuses to run one", async () => {
    gateway.brain.script = planWith(shoppingList);
    const { here, there, far } = await account();
    await ask(here, "Write my shopping list");
    const { task } = (await far.until(planned)) as TaskEvent;

    const run = await call(gateway.base, "POST", `/v1/tasks/${task.id}/control`, { token: there.device_token, body: { kind: "resume" } });
    expect(run.status).toBe(409);
    expect(ApiError.parse(await run.json()).message).toBe("I cannot run planned steps yet. That arrives with VENOM's hands on the computer.");

    const discarded = await call(gateway.base, "POST", `/v1/tasks/${task.id}/control`, { token: there.device_token, body: { kind: "discard" } });
    expect(discarded.status).toBe(200);
    expect(Task.parse(await discarded.json())).toMatchObject({ status: "cancelled", result: "Discarded. Nothing ran." });
    await far.until((event) => event.type === "task" && event.task.id === task.id && event.task.status === "cancelled");
  });
});

describe("the don't ask me list", () => {
  it("stops asking about posting when told to, and refuses to stop asking about paying or passwords", async () => {
    const { here } = await account();
    const saved = await call(gateway.base, "PUT", "/v1/settings/safety", {
      token: here.device_token,
      body: { confirmation_strictness: "standard", skip_asking: ["posts", "deletes"] },
    });
    expect(SafetySettings.parse(await saved.json())).toEqual({ confirmation_strictness: "standard", skip_asking: ["posts", "deletes"] });

    for (const effect of ["pays", "uses_credential"]) {
      const refused = await call(gateway.base, "PUT", "/v1/settings/safety", {
        token: here.device_token,
        body: { confirmation_strictness: "standard", skip_asking: [effect] },
      });
      expect(refused.status).toBe(400);
    }
    const kept = await call(gateway.base, "GET", "/v1/settings/safety", { token: here.device_token });
    expect(SafetySettings.parse(await kept.json()).skip_asking).toEqual(["posts", "deletes"]);
  });
});
