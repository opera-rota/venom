import type { Device } from "@venom/contracts";
import { connect, type DeviceRef } from "@venom/db";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTasks, type RoutedPlan, type RoutedStep, type Tasks } from "../src/index.ts";

let database: TestDatabase;
let owner: Sql;
let sql: Sql;
let tasks: Tasks;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  sql = connect(database.appUrl, { max: 4 });
  tasks = createTasks({ sql });
});

afterAll(async () => {
  await Promise.all([owner?.end(), sql?.end()]);
  await database?.drop();
});

async function device(): Promise<DeviceRef> {
  const created = await insertAccountWithDevice(owner);
  return { id: created.deviceId, account_id: created.accountId };
}

const steps: readonly RoutedStep[] = [
  { summary: "Open Notepad", spec: { name: "open_app", app: "Notepad", open: null }, effects: [], reversible: true },
  { summary: "Type the shopping list", spec: { name: "type_text", text: "Milk, bread, eggs", into: "the Notepad window" }, effects: [], reversible: true },
  { summary: "Delete last week's list", spec: { name: "click", on: "the Delete button" }, effects: ["deletes"], reversible: false },
  { summary: "Pay for the groceries", spec: { name: "click", on: "the Pay now button" }, effects: ["pays"], reversible: false },
];

function routed(here: DeviceRef): RoutedPlan {
  const target: Device = {
    id: here.id,
    account_id: here.account_id,
    type: "computer",
    name: "Test computer",
    platform: "windows",
    capabilities: { screen_control: true, microphone: false, speaker: false, shortcuts: false, notifications: false, network: true },
    status: "active",
    last_seen_at: null,
  };
  return { title: "Shopping list", target, elsewhere: false, missing: null, steps };
}

describe("a plan is saved as a task that has not started", () => {
  it("keeps every step with its details, and the fixed rules mark the ones that ask", async () => {
    const here = await device();
    const task = await tasks.plan(here, "Write my shopping list and pay for it", routed(here), uuidv7());

    expect(task.status).toBe("planned");
    expect(task.progress.percent).toBe(0);
    expect(task.plan.map((step) => [step.summary, step.status, step.requires_confirmation])).toEqual([
      ["Open Notepad", "pending", false],
      ["Type the shopping list", "pending", false],
      ["Delete last week's list", "pending", true],
      ["Pay for the groceries", "pending", true],
    ]);
    expect(task.plan[1]?.spec).toEqual({ name: "type_text", text: "Milk, bread, eggs", into: "the Notepad window" });
    expect(await tasks.next(here.account_id, task.id)).toEqual({ kind: "over" });
    const [audited] = await owner<{ detail: Record<string, unknown> }[]>`select detail from audit_log where action = 'task.planned' and subject_id = ${task.id}`;
    expect(audited?.detail).toEqual({ steps: 4, asking: 2, elsewhere: false });
  });

  it("stops asking about deleting when told to, but never about paying", async () => {
    const here = await device();
    const saved = await tasks.saveSettings(here, { confirmation_strictness: "standard", skip_asking: ["deletes"] }, uuidv7());
    expect(saved).toEqual({ confirmation_strictness: "standard", skip_asking: ["deletes"] });

    const task = await tasks.plan(here, "Write my shopping list and pay for it", routed(here), uuidv7());
    expect(task.plan.map((step) => step.requires_confirmation)).toEqual([false, false, false, true]);
    expect(await tasks.settings(here.account_id)).toEqual(saved);
  });

  it("runs a plan once, and never runs a discarded plan", async () => {
    const here = await device();
    const first = await tasks.plan(here, "Write my shopping list", routed(here), uuidv7());
    await expect(tasks.control(here, first.id, { kind: "resume" }, uuidv7())).rejects.toMatchObject({
      statusCode: 409,
      message: "This plan has not started yet. Press Run it to start it.",
    });
    const { task: started, run } = await tasks.control(here, first.id, { kind: "run" }, uuidv7());
    expect([started.status, run]).toEqual(["running", true]);
    await expect(tasks.control(here, first.id, { kind: "run" }, uuidv7())).rejects.toMatchObject({
      message: "Only a plan that has not started can be run. A stopped task can be resumed instead.",
    });
    expect(await tasks.next(here.account_id, first.id)).toMatchObject({
      kind: "step",
      step: { action: { name: "open_app", app: "Notepad", open: null }, requiresConfirmation: false },
    });
    await tasks.stop(here, { stop_id: uuidv7(), scope: { kind: "all" } }, uuidv7());

    const second = await tasks.plan(here, "Write my shopping list", routed(here), uuidv7());
    const { task: discarded, run: ran } = await tasks.control(here, second.id, { kind: "discard" }, uuidv7());
    expect([discarded.status, discarded.result, ran]).toEqual(["cancelled", "Discarded. Nothing ran.", false]);
    await expect(tasks.control(here, second.id, { kind: "discard" }, uuidv7())).rejects.toMatchObject({ statusCode: 409 });
    for (const kind of ["resume", "run"] as const) {
      await expect(tasks.control(here, second.id, { kind }, uuidv7())).rejects.toMatchObject({
        message: "This plan was discarded, so it will not run. Ask me again for a new plan.",
      });
    }
    expect((await tasks.get(here.account_id, second.id))?.status).toBe("cancelled");
  });

  it("refuses to run a plan that needs a service that is not connected", async () => {
    const here = await device();
    const email: RoutedStep = { summary: "Email the list", spec: { name: "call_connector", service: "mail", operation: "send an email", details: "To Alex" }, effects: ["reaches_outside"], reversible: false };
    const task = await tasks.plan(here, "Email my list", { ...routed(here), steps: [email] }, uuidv7());
    await expect(tasks.control(here, task.id, { kind: "run" }, uuidv7())).rejects.toMatchObject({
      message: "Step 1 needs a connected service, and connecting services is not possible yet. Nothing was done.",
    });
    expect((await tasks.get(here.account_id, task.id))?.status).toBe("planned");
  });

  it("never starts a script before a yes, even when an older plan saved it as not asking", async () => {
    const here = await device();
    const script: RoutedStep = { summary: "List the files", spec: { name: "run_script", language: "powershell", purpose: "List the files", code: "Get-ChildItem" }, effects: [], reversible: false };
    const task = await tasks.plan(here, "List my files", { ...routed(here), steps: [script] }, uuidv7());
    const stepId = task.plan[0]?.id ?? "";
    expect(task.plan[0]?.requires_confirmation).toBe(true);
    await owner`update steps set requires_confirmation = false where id = ${stepId}`;
    await tasks.control(here, task.id, { kind: "run" }, uuidv7());

    expect(await tasks.next(here.account_id, task.id)).toMatchObject({ kind: "step", step: { id: stepId, requiresConfirmation: true, approved: false } });
    expect(await tasks.start(here.account_id, stepId, uuidv7())).toBeNull();
    expect((await tasks.ask(here.account_id, stepId, uuidv7()))?.request.step_id).toBe(stepId);
    await tasks.answer(here, task.id, stepId, "approve", uuidv7());
    expect((await tasks.start(here.account_id, stepId, uuidv7()))?.plan[0]?.status).toBe("running");

    const finished = await tasks.finish(here.account_id, stepId, "done", "The script finished.", uuidv7(), "notes.txt\nlist.txt\n");
    expect(finished?.plan[0]?.output).toBe("The script finished.\n\nnotes.txt\nlist.txt");
    expect((await tasks.complete(here.account_id, task.id, uuidv7()))?.result).toBe("Finished. 1 step done.");
  });

  it("only lets a running task be discarded by stopping it, never by discard", async () => {
    const here = await device();
    const drill = await tasks.drill(here, "wait", uuidv7());
    await expect(tasks.control(here, drill.id, { kind: "discard" }, uuidv7())).rejects.toMatchObject({
      message: "Only a plan that has not started can be discarded.",
    });
    await tasks.stop(here, { stop_id: uuidv7(), scope: { kind: "all" } }, uuidv7());
  });
});
