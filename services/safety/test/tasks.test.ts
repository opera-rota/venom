import { connect, type DeviceRef } from "@venom/db";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTasks, createTrust, liveChallengeText, newKeyPair, signText, type Tasks, type Trust } from "../src/index.ts";

let database: TestDatabase;
let owner: Sql;
let sql: Sql;
let tasks: Tasks;
let trust: Trust;
const server = newKeyPair();

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  sql = connect(database.appUrl, { max: 4 });
  tasks = createTasks({ sql });
  trust = createTrust({ sql, serverKey: server.publicKey });
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

describe("device trust", () => {
  it("enrolls a key once, then proves a fresh challenge only once", async () => {
    const here = await device();
    const pair = newKeyPair();
    await expect(trust.challenge(here)).rejects.toMatchObject({ code: "device_key_missing" });
    expect(await trust.enroll(here, pair.publicKey, uuidv7())).toEqual({ device_id: here.id, server_key: server.publicKey });
    expect(await trust.enroll(here, pair.publicKey, uuidv7())).toEqual({ device_id: here.id, server_key: server.publicKey });
    await expect(trust.enroll(here, newKeyPair().publicKey, uuidv7())).rejects.toMatchObject({ statusCode: 409 });

    const challenge = await trust.challenge(here);
    const signature = signText(pair, liveChallengeText(here.id, challenge.challenge_id, challenge.nonce));
    expect(await trust.prove(here, challenge.challenge_id, signature)).toBe(true);
    expect(await trust.prove(here, challenge.challenge_id, signature)).toBe(false);

    const other = await trust.challenge(here);
    const forged = signText(newKeyPair(), liveChallengeText(here.id, other.challenge_id, other.nonce));
    expect(await trust.prove(here, other.challenge_id, forged)).toBe(false);
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
