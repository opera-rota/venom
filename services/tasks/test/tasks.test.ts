import type { Task } from "@venom/contracts";
import { connect, type DeviceRef } from "@venom/db";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTasks, type Tasks } from "../src/index.ts";

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

async function nextStepId(here: DeviceRef, taskId: string): Promise<string> {
  const next = await tasks.next(here.account_id, taskId);
  if (next.kind !== "step") {
    throw new Error(`expected a step, got ${next.kind}`);
  }
  return next.step.id;
}

describe("a stop keeps finished work and records what happened", () => {
  it("stops a running drill: done stays done, running is stopped by the device, the rest never started", async () => {
    const here = await device();
    const task = await tasks.drill(here, "wait", uuidv7());
    const first = await nextStepId(here, task.id);
    await tasks.start(here.account_id, first, uuidv7());
    await tasks.finish(here.account_id, first, "done", "Waited 3 seconds.", uuidv7());
    const second = await nextStepId(here, task.id);
    await tasks.start(here.account_id, second, uuidv7());

    const stopId = uuidv7();
    const { receipt } = await tasks.stop(here, { stop_id: stopId, scope: { kind: "all" } }, uuidv7());
    expect(receipt.tasks.map((stopped) => stopped.plan.map((step) => step.status))).toEqual([["done", "running", "pending"]]);
    expect(receipt.tasks[0]?.result).toBe("Stopped. 1 finished, 1 stopped (stopping now), 1 never started.");

    const settled = await tasks.finish(here.account_id, second, "stopped", "Stopped after 4 of 30 seconds.", uuidv7());
    expect(settled?.status).toBe("stopped");
    expect(settled?.result).toBe("Stopped. 1 finished, 1 stopped, 1 never started.");
    expect(await tasks.next(here.account_id, task.id)).toEqual({ kind: "over" });

    const again = await tasks.stop(here, { stop_id: stopId, scope: { kind: "all" } }, uuidv7());
    expect(again.receipt.tasks[0]?.plan.map((step) => step.status)).toEqual(["done", "stopped", "pending"]);
    const [audited] = await owner<{ total: number }[]>`select count(*)::int as total from audit_log where action = 'safety.stopped' and subject_id = ${stopId}`;
    expect(audited?.total).toBe(1);
  });

  it("refuses a stop number already used by another account", async () => {
    const stopId = uuidv7();
    await tasks.stop(await device(), { stop_id: stopId, scope: { kind: "all" } }, uuidv7());
    await expect(tasks.stop(await device(), { stop_id: stopId, scope: { kind: "all" } }, uuidv7())).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("a sensitive step pauses for confirmation", () => {
  it("asks, lets the first answer win and refuses the second", async () => {
    const here = await device();
    const task = await tasks.drill(here, "sensitive", uuidv7());
    const first = await nextStepId(here, task.id);
    await tasks.start(here.account_id, first, uuidv7());
    await tasks.finish(here.account_id, first, "done", "Waited 3 seconds.", uuidv7());

    const sensitive = await nextStepId(here, task.id);
    expect(await tasks.start(here.account_id, sensitive, uuidv7())).toBeNull();
    const asked = await tasks.ask(here.account_id, sensitive, uuidv7());
    expect(asked?.task.status).toBe("awaiting_confirmation");
    expect(asked?.request).toMatchObject({ risk: "high", reasons: ["deletes"], reversible: false, target_name: "Test computer" });
    expect((await tasks.list(here.account_id)).confirmations).toHaveLength(1);

    const answered = await tasks.answer(here, task.id, sensitive, "approve", uuidv7());
    expect(answered.answered).toMatchObject({ outcome: "approved", device_name: "Test computer" });
    await expect(tasks.answer(here, task.id, sensitive, "decline", uuidv7())).rejects.toMatchObject({ code: "already_answered" });
    expect(await tasks.start(here.account_id, sensitive, uuidv7())).toMatchObject({ status: "running" });
  });

  it("cancels the task when the step is declined and never runs it", async () => {
    const here = await device();
    const task = await tasks.drill(here, "sensitive", uuidv7());
    const first = await nextStepId(here, task.id);
    await tasks.start(here.account_id, first, uuidv7());
    await tasks.finish(here.account_id, first, "done", "Waited 3 seconds.", uuidv7());
    const sensitive = await nextStepId(here, task.id);
    await tasks.ask(here.account_id, sensitive, uuidv7());
    const declined = await tasks.answer(here, task.id, sensitive, "decline", uuidv7());
    expect(declined.task.status).toBe("cancelled");
    expect(declined.task.plan.map((step) => step.status)).toEqual(["done", "stopped", "pending"]);
  });

  it("closes an open confirmation when stopped, so it can no longer be approved", async () => {
    const here = await device();
    const task = await tasks.drill(here, "sensitive", uuidv7());
    const first = await nextStepId(here, task.id);
    await tasks.start(here.account_id, first, uuidv7());
    await tasks.finish(here.account_id, first, "done", "Waited 3 seconds.", uuidv7());
    const sensitive = await nextStepId(here, task.id);
    await tasks.ask(here.account_id, sensitive, uuidv7());
    const { closed } = await tasks.stop(here, { stop_id: uuidv7(), scope: { kind: "task", task_id: task.id } }, uuidv7());
    expect(closed.map((request) => request.step_id)).toEqual([sensitive]);
    await expect(tasks.answer(here, task.id, sensitive, "approve", uuidv7())).rejects.toMatchObject({ code: "already_answered" });
  });
});

describe("limits and restarts", () => {
  it("runs at most three tasks at once per account", async () => {
    const here = await device();
    for (let started = 0; started < 3; started += 1) {
      await tasks.drill(here, "wait", uuidv7());
    }
    await expect(tasks.drill(here, "wait", uuidv7())).rejects.toMatchObject({ statusCode: 409 });
  });

  it("marks unfinished tasks as failed when the gateway restarts, keeping finished steps", async () => {
    const here = await device();
    const task = await tasks.drill(here, "wait", uuidv7());
    const first = await nextStepId(here, task.id);
    await tasks.start(here.account_id, first, uuidv7());
    await tasks.finish(here.account_id, first, "done", "Waited 3 seconds.", uuidv7());
    await tasks.start(here.account_id, await nextStepId(here, task.id), uuidv7());
    expect(await tasks.interruptAll()).toBeGreaterThan(0);
    const after = await tasks.get(here.account_id, task.id);
    expect(after?.plan.map((step) => step.status)).toEqual(["done", "failed", "pending"]);
    expect(after?.result).toBe("Failed. VENOM restarted before this step finished. 1 finished before that.");
  });
});

async function runNext(here: DeviceRef, taskId: string, outcome: "done" | "failed" | "stopped" = "done"): Promise<Task | null> {
  const stepId = await nextStepId(here, taskId);
  await tasks.start(here.account_id, stepId, uuidv7());
  return tasks.finish(here.account_id, stepId, outcome, outcome === "done" ? "Waited 8 seconds." : "The device could not finish this step.", uuidv7());
}

function percents(task: Task | null): string {
  return task === null ? "none" : `${task.progress.done}/${task.progress.counted} ${task.progress.percent}%`;
}

describe("the seeded five step task proves the progress engine", () => {
  it("moves exactly as the formula predicts, and ignoring a step shrinks the total", async () => {
    const here = await device();
    const task = await tasks.drill(here, "progress", uuidv7());
    expect(task.plan.map((step) => step.summary)).toEqual([1, 2, 3, 4, 5].map((part) => `Practice step ${part} of 5: wait 8 seconds`));
    expect(percents(task)).toBe("0/5 0%");
    expect(percents(await runNext(here, task.id))).toBe("1/5 20%");
    expect(percents(await runNext(here, task.id))).toBe("2/5 40%");

    const fifth = task.plan[4]?.id ?? "";
    const ignored = await tasks.control(here, task.id, { kind: "ignore", step_id: fifth, reason: "Not needed today" }, uuidv7());
    expect(ignored.run).toBe(false);
    expect(ignored.task.progress).toEqual({ done: 2, counted: 4, skipped: 0, ignored: 1, total: 5, percent: 50 });
    expect(ignored.task.plan[4]).toMatchObject({ status: "ignored", set_aside_reason: "Not needed today" });

    expect(percents(await runNext(here, task.id))).toBe("3/4 75%");
    expect(percents(await runNext(here, task.id))).toBe("4/4 100%");
    expect(await tasks.next(here.account_id, task.id)).toEqual({ kind: "finished" });
    const finished = await tasks.complete(here.account_id, task.id, uuidv7());
    expect(finished).toMatchObject({ status: "completed", result: "Finished. 4 steps done, 1 ignored." });
    await expect(tasks.control(here, task.id, { kind: "restore", step_id: fifth }, uuidv7())).rejects.toMatchObject({ statusCode: 409 });
  });

  it("keeps a skipped step counted and comes back to it after the others", async () => {
    const here = await device();
    const task = await tasks.drill(here, "progress", uuidv7());
    const second = task.plan[1]?.id ?? "";
    const skipped = await tasks.control(here, task.id, { kind: "skip", step_id: second, reason: "Come back to this later" }, uuidv7());
    expect(skipped.task.progress).toMatchObject({ counted: 5, skipped: 1, percent: 0 });
    for (const expected of ["1/5 20%", "2/5 40%", "3/5 60%", "4/5 80%"]) {
      expect(percents(await runNext(here, task.id))).toBe(expected);
    }
    expect(await tasks.next(here.account_id, task.id)).toEqual({ kind: "come_back", stepId: second });
    const back = await tasks.comeBack(here.account_id, second, uuidv7());
    expect(back?.plan[1]).toMatchObject({ status: "pending", set_aside_reason: null });
    expect(percents(await runNext(here, task.id))).toBe("5/5 100%");
  });

  it("brings an ignored step back, and never lets the last counted step be ignored", async () => {
    const here = await device();
    const task = await tasks.drill(here, "progress", uuidv7());
    const ids = task.plan.map((step) => step.id);
    for (const stepId of ids.slice(1)) {
      await tasks.control(here, task.id, { kind: "ignore", step_id: stepId, reason: "Testing the limit" }, uuidv7());
    }
    await expect(tasks.control(here, task.id, { kind: "ignore", step_id: ids[0] ?? "", reason: "Testing the limit" }, uuidv7())).rejects.toMatchObject({
      message: "At least one step must still count. Stop the task instead.",
    });
    const restored = await tasks.control(here, task.id, { kind: "restore", step_id: ids[4] ?? "" }, uuidv7());
    expect(restored.task.plan[4]).toMatchObject({ status: "pending", set_aside_reason: null });
    expect(restored.task.progress).toMatchObject({ counted: 2, ignored: 3 });
  });
});

describe("resume and retry continue from the first unfinished step", () => {
  it("resumes a stopped task without touching finished work", async () => {
    const here = await device();
    const task = await tasks.drill(here, "progress", uuidv7());
    await runNext(here, task.id);
    const second = await nextStepId(here, task.id);
    await tasks.start(here.account_id, second, uuidv7());
    await tasks.stop(here, { stop_id: uuidv7(), scope: { kind: "task", task_id: task.id } }, uuidv7());
    await expect(tasks.control(here, task.id, { kind: "resume" }, uuidv7())).rejects.toMatchObject({ message: "A step of this task is still stopping. Try again in a moment." });
    await tasks.finish(here.account_id, second, "stopped", "Stopped after 3 of 8 seconds.", uuidv7());

    const resumed = await tasks.control(here, task.id, { kind: "resume" }, uuidv7());
    expect(resumed.run).toBe(true);
    expect(resumed.task).toMatchObject({ status: "running", result: null });
    expect(resumed.task.plan.map((step) => step.status)).toEqual(["done", "pending", "pending", "pending", "pending"]);
    expect(resumed.task.plan[1]?.output).toBeNull();
    await expect(tasks.control(here, task.id, { kind: "resume" }, uuidv7())).rejects.toMatchObject({ message: "This task is already running." });
  });

  it("retries a failed step that is safe to repeat, and refuses one that is not failed", async () => {
    const here = await device();
    const task = await tasks.drill(here, "progress", uuidv7());
    const failed = await runNext(here, task.id, "failed");
    expect(failed).toMatchObject({ status: "failed", result: "Failed. The device could not finish this step. 0 finished before that." });
    await expect(tasks.control(here, task.id, { kind: "retry", step_id: task.plan[1]?.id ?? "" }, uuidv7())).rejects.toMatchObject({ message: "Only a failed step can be tried again." });
    const retried = await tasks.control(here, task.id, { kind: "retry", step_id: task.plan[0]?.id ?? "" }, uuidv7());
    expect(retried.task.plan[0]).toMatchObject({ status: "pending", repeatable: true });
    expect(retried.task.status).toBe("running");
  });

  it("asks again for a declined step when a cancelled task is resumed", async () => {
    const here = await device();
    const task = await tasks.drill(here, "sensitive", uuidv7());
    await runNext(here, task.id);
    const sensitive = await nextStepId(here, task.id);
    await tasks.ask(here.account_id, sensitive, uuidv7());
    await tasks.answer(here, task.id, sensitive, "decline", uuidv7());
    const resumed = await tasks.control(here, task.id, { kind: "resume" }, uuidv7());
    expect(resumed.task.plan.map((step) => step.status)).toEqual(["done", "pending", "pending"]);
    expect(await tasks.next(here.account_id, task.id)).toMatchObject({ kind: "step", step: { id: sensitive, approved: false, requiresConfirmation: true } });
  });
});
