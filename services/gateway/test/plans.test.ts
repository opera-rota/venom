import { ApiError, MessageHistory, SafetySettings, Task, type DeviceSession, type GatewayEvent, type MessageEvent, type MessageKind, type PlanDraft, type StepOutputEvent, type TaskEvent } from "@venom/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { answerWith, planWith } from "../src/testing.ts";
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
    { summary: "Open Notepad", spec: { name: "open_app", app: "Notepad", open: null }, effects: [], reversible: true },
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

function said(kind: MessageKind, text?: string) {
  return (event: GatewayEvent): event is MessageEvent =>
    event.type === "message" && event.message.speaker === "venom" && event.message.kind === kind && (text === undefined || event.message.text === text);
}

function repliedTo(requestId: string) {
  return (event: GatewayEvent): event is MessageEvent => event.type === "message" && event.message.speaker === "venom" && event.request_id === requestId && event.message.kind === "text";
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
    expect(message.kind).toBe("plan");
    expect(message.text).toBe(
      `Here is my plan: Shopping list on the desktop. It has 3 steps, and I would ask you before 1 of them. ${here.device.name} has no working hands right now, so this plan cannot run there yet. Nothing has been done.`,
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

  it("discards a plan from any device, and refuses to resume one that never started", async () => {
    gateway.brain.script = planWith(shoppingList);
    const { here, there, far } = await account();
    await ask(here, "Write my shopping list");
    const { task } = (await far.until(planned)) as TaskEvent;

    const run = await call(gateway.base, "POST", `/v1/tasks/${task.id}/control`, { token: there.device_token, body: { kind: "resume" } });
    expect(run.status).toBe(409);
    expect(ApiError.parse(await run.json()).message).toBe("This plan has not started yet. Press Run it to start it.");

    const discarded = await call(gateway.base, "POST", `/v1/tasks/${task.id}/control`, { token: there.device_token, body: { kind: "discard" } });
    expect(discarded.status).toBe(200);
    expect(Task.parse(await discarded.json())).toMatchObject({ status: "cancelled", result: "Discarded. Nothing ran." });
    await far.until((event) => event.type === "task" && event.task.id === task.id && event.task.status === "cancelled");
  });
});

async function withHands(session: DeviceSession): Promise<void> {
  const response = await call(gateway.base, "PUT", "/v1/devices/current/capabilities", {
    token: session.device_token,
    body: { device_id: session.device.id, capabilities: { ...session.device.capabilities, screen_control: true } },
  });
  expect(response.status).toBe(200);
}

async function say(session: DeviceSession, text: string): Promise<string> {
  const response = await call(gateway.base, "POST", "/v1/messages", { token: session.device_token, body: { text } });
  expect(response.status).toBe(202);
  return ((await response.json()) as { request_id: string }).request_id;
}

const notes: PlanDraft = {
  title: "Notes with a folder list",
  steps: [
    { summary: "Open Notepad", spec: { name: "open_app", app: "Notepad", open: null }, effects: [], reversible: true },
    { summary: "List the work folder", spec: { name: "run_script", language: "powershell", purpose: "List the work folder", code: "Get-ChildItem" }, effects: [], reversible: true },
    { summary: "Type a note", spec: { name: "type_text", text: "Hello from VENOM", into: "Notepad" }, effects: [], reversible: true },
  ],
  cannot: null,
};

const scriptFirst: PlanDraft = {
  title: "A script that needs a yes",
  steps: [{ summary: "Clean the work folder", spec: { name: "run_script", language: "powershell", purpose: "Clean the work folder", code: "Remove-Item *.tmp" }, effects: [], reversible: true }],
  cannot: null,
};

const longWait: PlanDraft = {
  title: "Wait half a minute",
  steps: [{ summary: "Wait 30 seconds", spec: { name: "wait", seconds: 30 }, effects: [], reversible: true }],
  cannot: null,
};

describe("Definition of done: a plan runs on the computer, asks in the chat and reports back", () => {
  it("runs every step from Run it, asks before the script in the chat, streams its output and says Done", async () => {
    gateway.brain.script = planWith(notes);
    const { here, there, near, far } = await account();
    await withHands(here);
    await ask(here, "Open Notepad, list my work folder and write a note");

    const { task } = (await far.until(planned)) as TaskEvent;
    const plan = (await far.until(said("plan"))) as MessageEvent;
    expect(plan.message.text).toBe('Here is my plan: Notes with a folder list. It has 3 steps, and I would ask you before 1 of them. Nothing has run yet. Say "run it" or press Run it when you are ready.');

    const run = await call(gateway.base, "POST", `/v1/tasks/${task.id}/control`, { token: there.device_token, body: { kind: "run" } });
    expect(run.status).toBe(200);
    expect(Task.parse(await run.json()).status).toBe("running");

    const script = task.plan[1]?.id ?? "";
    const question = (await far.until(said("question"))) as MessageEvent;
    expect([question.message.task_id, question.message.step_id]).toEqual([task.id, script]);
    expect(question.message.text).toBe(
      `Quick check before I go on. List the work folder on ${here.device.name}. This cannot be undone. I always check with you before I run a script. Shall I do it? Just say yes or no.`,
    );
    expect(near.commands.map((command) => [command.action.name, command.confirmed])).toEqual([["open_app", false]]);

    const yes = await say(there, "Yes!");
    expect(((await far.until(repliedTo(yes))) as MessageEvent).message.text).toBe("Okay, doing it now.");

    const done = (await far.until(said("report"))) as MessageEvent;
    expect(done.message.text).toBe('Done. "Open Notepad, list my work folder and write a note" is finished, and all 3 steps worked.');
    expect(near.commands.map((command) => [command.action.name, command.confirmed])).toEqual([
      ["open_app", false],
      ["run_script", true],
      ["type_text", false],
    ]);
    const output = far.events.filter((event): event is StepOutputEvent => event.type === "step_output");
    expect(output.map((event) => [event.step_id, event.chunk, event.text])).toEqual([
      [script, 0, "Running: List the work folder\n"],
      [script, 1, "All good."],
    ]);
    const finished = (await far.until((event) => event.type === "task" && event.task.id === task.id && event.task.status === "completed")) as TaskEvent;
    expect(finished.task.plan[1]?.output).toBe("The script finished with exit code 0.\n\nRunning: List the work folder\nAll good.");
    expect(gateway.brain.requests.at(-1)?.text).toBe("Open Notepad, list my work folder and write a note");
  }, 20_000);

  it("starts the newest plan when told to run it, takes no for an answer and never sends the script", async () => {
    gateway.brain.script = planWith(scriptFirst);
    const { here, near, far } = await account();
    await withHands(here);
    const asked = gateway.brain.requests.length;

    const early = await say(here, "run it");
    expect(((await far.until(repliedTo(early))) as MessageEvent).message.text).toBe("There is no plan waiting to run. Tell me what you would like done, and I will plan it first.");

    await ask(here, "Clean my work folder");
    const { task } = (await far.until(planned)) as TaskEvent;
    const go = await say(here, "Run it.");
    expect(((await far.until(repliedTo(go))) as MessageEvent).message.text).toBe('On it. I am starting "Clean my work folder" now.');
    await far.until(said("question"));

    const no = await say(here, "no");
    expect(((await far.until(repliedTo(no))) as MessageEvent).message.text).toBe('Okay, I did not do it. I cancelled the rest of "Clean my work folder" too.');
    await far.until((event) => event.type === "task" && event.task.id === task.id && event.task.status === "cancelled");
    expect(near.commands).toEqual([]);
    expect(far.events.filter(said("report"))).toEqual([]);
    expect(gateway.brain.requests.length).toBe(asked + 1);
  }, 20_000);

  it("stops everything when stop is typed, and says so plainly when nothing runs", async () => {
    gateway.brain.script = planWith(longWait);
    const { here, near, far } = await account();
    const idle = await say(here, "Stop");
    expect(((await far.until(repliedTo(idle))) as MessageEvent).message.text).toBe("Nothing was running, so there was nothing to stop.");

    await ask(here, "Wait half a minute");
    const { task } = (await far.until(planned)) as TaskEvent;
    await say(here, "do it");
    await near.until(() => near.commands.length === 1);
    const started = Date.now();
    const stop = await say(here, "stop everything");
    expect(((await far.until(repliedTo(stop))) as MessageEvent).message.text).toBe("Okay, stopping everything now.");
    expect(((await far.until(said("report"))) as MessageEvent).message.text).toBe('Stopped. Nothing more will run for "Wait half a minute".');
    const halted = await near.reported(task.plan[0]?.id ?? "");
    expect(halted.outcome).toBe("stopped");
    expect(halted.at - started).toBeLessThan(1000);
  }, 20_000);

  it("treats yes as normal chat when nothing is waiting, and rejects output for a command that is not running", async () => {
    gateway.brain.script = answerWith(() => "Happy to help.");
    const { here, far } = await account();
    const asked = gateway.brain.requests.length;
    await say(here, "yes");
    await far.until(said("text", "Happy to help."));
    expect(gateway.brain.requests.length).toBe(asked + 1);

    const stray = await call(gateway.base, "POST", "/v1/commands/output", { token: here.device_token, body: { command_id: here.device.id, sequence: 0, text: "hello" } });
    expect(stray.status).toBe(404);
  });
});

describe("the don't ask me list", () => {
  it("is changed by plain sentences in the chat, and never stops asking about money or passwords", async () => {
    const { here, far } = await account();
    const skip = await say(here, "Don't ask me before reaching outside the computer");
    expect(((await far.until(repliedTo(skip))) as MessageEvent).message.text).toBe(
      'Okay. I will not ask before reaching outside the computer any more. I still always ask before money, passwords and scripts. Say "ask me again before reaching outside the computer" to undo this.',
    );
    const settings = async () => SafetySettings.parse(await (await call(gateway.base, "GET", "/v1/settings/safety", { token: here.device_token })).json()).skip_asking;
    expect(await settings()).toEqual(["reaches_outside"]);

    const money = await say(here, "please don't ask me before paying");
    expect(((await far.until(repliedTo(money))) as MessageEvent).message.text).toBe("I always ask before anything that spends money or uses a password, and that cannot be turned off.");

    const again = await say(here, "Ask me again before opening websites");
    expect(((await far.until(repliedTo(again))) as MessageEvent).message.text).toBe("Okay. I will ask you again before reaching outside the computer.");
    expect(await settings()).toEqual([]);
  });

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
