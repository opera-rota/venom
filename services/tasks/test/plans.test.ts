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
  { summary: "Open Notepad", spec: { name: "open_app", app: "Notepad" }, effects: [], reversible: true },
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

  it("discards a plan once, and never runs one yet", async () => {
    const here = await device();
    const task = await tasks.plan(here, "Write my shopping list", routed(here), uuidv7());

    await expect(tasks.control(here, task.id, { kind: "resume" }, uuidv7())).rejects.toMatchObject({
      statusCode: 409,
      message: "I cannot run planned steps yet. That arrives with VENOM's hands on the computer.",
    });
    const { task: discarded, run } = await tasks.control(here, task.id, { kind: "discard" }, uuidv7());
    expect([discarded.status, discarded.result, run]).toEqual(["cancelled", "Discarded. Nothing ran.", false]);
    await expect(tasks.control(here, task.id, { kind: "discard" }, uuidv7())).rejects.toMatchObject({ statusCode: 409 });
    await expect(tasks.control(here, task.id, { kind: "resume" }, uuidv7())).rejects.toMatchObject({
      message: "I cannot run planned steps yet. That arrives with VENOM's hands on the computer.",
    });
    expect((await tasks.get(here.account_id, task.id))?.status).toBe("cancelled");
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
