import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "../src/index.ts";
import { createTestDatabase, insertAccountWithDevice, type TestAccount, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let owner: Sql;
let app: Sql;
let account: TestAccount;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  app = connect(database.appUrl, { max: 1 });
  account = await insertAccountWithDevice(owner);
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
  await database?.drop();
});

async function insertTask(status: string): Promise<{ readonly taskId: string; readonly stepId: string }> {
  const [task] = await app<{ id: string }[]>`
    insert into tasks (account_id, origin_device_id, target_device_id, request_text, status)
    values (${account.accountId}, ${account.deviceId}, ${account.deviceId}, 'Progress drill', ${status})
    returning id
  `;
  const [step] = await app<{ id: string }[]>`
    insert into steps (task_id, account_id, position, summary, action, params, target_device_id, requires_confirmation, reversible, on_failure)
    values (${task?.id ?? null}, ${account.accountId}, 0, 'Wait 8 seconds', 'wait', ${app.json({ seconds: 8 })}, ${account.deviceId}, false, true, 'abort')
    returning id
  `;
  return { taskId: task?.id ?? "", stepId: step?.id ?? "" };
}

describe("ignoring and skipping a step", () => {
  it("lets the app ignore a pending step with a reason, and bring it back", async () => {
    const { stepId } = await insertTask("running");
    const ignored = await app`
      update steps set status = 'ignored', set_aside_reason = 'Not needed today', set_aside_at = clock_timestamp(), set_aside_by = ${account.deviceId}
      where id = ${stepId}
    `;
    expect(ignored.count).toBe(1);
    const restored = await app`update steps set status = 'pending', set_aside_reason = null, set_aside_at = null, set_aside_by = null where id = ${stepId}`;
    expect(restored.count).toBe(1);
  });

  it("refuses to ignore or skip a step without a reason", async () => {
    const { stepId } = await insertTask("running");
    await expect(app`update steps set status = 'ignored' where id = ${stepId}`).rejects.toMatchObject({ code: "23514" });
    await expect(app`update steps set status = 'skipped' where id = ${stepId}`).rejects.toMatchObject({ code: "23514" });
  });
});

describe("the state machine is enforced by the database", () => {
  it("refuses a step that jumps from pending to done, even for the table owner", async () => {
    const { stepId } = await insertTask("running");
    await expect(owner`update steps set status = 'done', started_at = clock_timestamp(), finished_at = clock_timestamp() where id = ${stepId}`).rejects.toMatchObject({
      code: "23001",
    });
  });

  it("refuses to reopen a completed task, but lets a stopped one resume", async () => {
    const completed = await insertTask("completed");
    await expect(owner`update tasks set status = 'running' where id = ${completed.taskId}`).rejects.toMatchObject({ code: "23001" });
    const stopped = await insertTask("stopped");
    expect((await app`update tasks set status = 'running' where id = ${stopped.taskId}`).count).toBe(1);
  });
});
