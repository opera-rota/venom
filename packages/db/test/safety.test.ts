import { randomBytes } from "node:crypto";
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

async function insertStep(status: string): Promise<string> {
  const [task] = await app<{ id: string }[]>`
    insert into tasks (account_id, origin_device_id, target_device_id, request_text, status)
    values (${account.accountId}, ${account.deviceId}, ${account.deviceId}, 'Safety drill', 'running')
    returning id
  `;
  const [step] = await app<{ id: string }[]>`
    insert into steps (task_id, account_id, position, summary, action, params, target_device_id, requires_confirmation, reversible, on_failure, status, started_at, finished_at)
    values (
      ${task?.id ?? null}, ${account.accountId}, 0, 'Wait 3 seconds', 'wait', ${app.json({ seconds: 3 })}, ${account.deviceId},
      false, true, 'abort', ${status}, clock_timestamp(), clock_timestamp()
    )
    returning id
  `;
  return step?.id ?? "";
}

describe("device keys are enrolled once", () => {
  it("lets the app enroll a key on a device that has none", async () => {
    const result = await app`
      update devices set public_key = ${randomBytes(32)}, key_enrolled_at = clock_timestamp()
      where id = ${account.deviceId} and public_key is null
    `;
    expect(result.count).toBe(1);
  });

  it("refuses to replace an enrolled key, even for the table owner", async () => {
    await expect(owner`update devices set public_key = ${randomBytes(32)} where id = ${account.deviceId}`).rejects.toMatchObject({ code: "23001" });
  });
});

describe("finished work stays finished", () => {
  it("refuses to turn a done step into anything else, even for the table owner", async () => {
    const stepId = await insertStep("done");
    await expect(app`update steps set status = 'stopped' where id = ${stepId}`).rejects.toMatchObject({ code: "23001" });
    await expect(owner`update steps set status = 'pending' where id = ${stepId}`).rejects.toMatchObject({ code: "23001" });
  });

  it("lets a running step become stopped", async () => {
    const stepId = await insertStep("running");
    const result = await app`update steps set status = 'stopped', output = 'Stopped after 2 of 3 seconds.' where id = ${stepId}`;
    expect(result.count).toBe(1);
  });

  it("refuses a step action outside the fixed menu", async () => {
    await expect(owner`update steps set action = 'shell' where position = 0`).rejects.toMatchObject({ code: "23514" });
  });
});

describe("the app role cannot erase safety records", () => {
  it.each(["tasks", "steps", "stops", "live_challenges"])("refuses delete on %s", async (table) => {
    await expect(app.unsafe(`delete from ${table}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses to change a task's request text", async () => {
    await expect(app`update tasks set request_text = 'changed'`).rejects.toMatchObject({ code: "42501" });
  });

  it("lets the app change only the confirmation strictness of an account", async () => {
    const result = await app`update accounts set confirmation_strictness = 'strict' where id = ${account.accountId}`;
    expect(result.count).toBe(1);
    await expect(app`update accounts set email = 'changed@venom.test'`).rejects.toMatchObject({ code: "42501" });
  });
});
