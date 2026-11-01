import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, createStore, type Store } from "../src/index.ts";
import { createTestDatabase, insertAccountWithDevice, type TestAccount, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let owner: Sql;
let app: Sql;
let store: Store;
let account: TestAccount;
let stranger: TestAccount;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  app = connect(database.appUrl, { max: 1 });
  store = createStore(database.appUrl);
  account = await insertAccountWithDevice(owner);
  stranger = await insertAccountWithDevice(owner);
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end(), store?.close()]);
  await database?.drop();
});

async function plannedTask(of: TestAccount): Promise<string> {
  const [task] = await app<{ id: string }[]>`
    insert into tasks (account_id, origin_device_id, target_device_id, request_text, status)
    values (${of.accountId}, ${of.deviceId}, ${of.deviceId}, 'Open Notepad and write a list', 'planned')
    returning id
  `;
  return task?.id ?? "";
}

const requestId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e99";

describe("a reply that carries a plan", () => {
  it("points at its task and keeps the link when read back", async () => {
    const taskId = await plannedTask(account);
    const device = { id: account.deviceId, account_id: account.accountId };
    const reply = await store.recordMessage({ device, requestId, speaker: "venom", text: "Here is my plan.", taskId, answer: { model: null, intent: "task" } });
    expect(reply.task_id).toBe(taskId);
    const { messages } = await store.listConversation(account.accountId, 10);
    expect(messages.find((message) => message.id === reply.id)?.task_id).toBe(taskId);
  });

  it("refuses a task of another account and a task on the user's own words", async () => {
    const theirs = await plannedTask(stranger);
    const ours = await plannedTask(account);
    await expect(app`
      insert into messages (account_id, device_id, request_id, speaker, text, task_id)
      values (${account.accountId}, ${account.deviceId}, ${requestId}, 'venom', 'Plan', ${theirs})
    `).rejects.toMatchObject({ code: "23503" });
    await expect(app`
      insert into messages (account_id, device_id, request_id, speaker, text, task_id)
      values (${account.accountId}, ${account.deviceId}, ${requestId}, 'user', 'Plan', ${ours})
    `).rejects.toMatchObject({ code: "23514" });
  });
});

describe("the don't ask me list", () => {
  it("lets the app stop asking about deleting, posting and reaching outside", async () => {
    const saved = await app`update accounts set skip_asking = array['deletes', 'posts', 'reaches_outside'] where id = ${account.accountId}`;
    expect(saved.count).toBe(1);
  });

  it("never lets paying or passwords stop asking, even for the table owner", async () => {
    await expect(owner`update accounts set skip_asking = array['pays'] where id = ${account.accountId}`).rejects.toMatchObject({ code: "23514" });
    await expect(owner`update accounts set skip_asking = array['posts', 'uses_credential'] where id = ${account.accountId}`).rejects.toMatchObject({ code: "23514" });
  });
});
