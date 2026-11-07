import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, createStore, type Store } from "../src/index.ts";
import { createTestDatabase, insertAccountWithDevice, type TestAccount, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let owner: Sql;
let app: Sql;
let store: Store;
let account: TestAccount;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  app = connect(database.appUrl, { max: 1 });
  store = createStore(database.appUrl);
  account = await insertAccountWithDevice(owner);
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end(), store?.close()]);
  await database?.drop();
});

async function scriptStep(): Promise<{ taskId: string; stepId: string }> {
  const [task] = await app<{ id: string }[]>`
    insert into tasks (account_id, origin_device_id, target_device_id, request_text, status)
    values (${account.accountId}, ${account.deviceId}, ${account.deviceId}, 'List the biggest files', 'planned')
    returning id
  `;
  const params = { name: "run_script", language: "powershell", purpose: "List the biggest files", code: "Get-ChildItem" };
  const [step] = await app<{ id: string }[]>`
    insert into steps (task_id, account_id, position, summary, action, params, target_device_id, requires_confirmation, reversible, on_failure)
    values (${task?.id ?? null}, ${account.accountId}, 0, 'List the biggest files', 'run_script', ${app.json(params)}, ${account.deviceId}, true, false, 'abort')
    returning id
  `;
  return { taskId: task?.id ?? "", stepId: step?.id ?? "" };
}

const requestId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e98";
const device = () => ({ id: account.deviceId, account_id: account.accountId });

describe("VENOM's messages about running work", () => {
  it("keeps a question linked to its task and step, and a report linked to its task", async () => {
    const { taskId, stepId } = await scriptStep();
    const question = await store.recordMessage({ device: device(), requestId, speaker: "venom", kind: "question", text: "You sure, buddy?", taskId, stepId });
    const report = await store.recordMessage({ device: device(), requestId, speaker: "venom", kind: "report", text: "Done.", taskId });
    expect(question).toMatchObject({ kind: "question", task_id: taskId, step_id: stepId });
    expect(report).toMatchObject({ kind: "report", task_id: taskId, step_id: null });
    const { messages } = await store.listConversation(account.accountId, 10);
    expect(messages.filter((message) => message.task_id === taskId).map((message) => message.kind)).toEqual(["question", "report"]);
  });

  it("marks a reply that carries a plan as a plan when no kind is given", async () => {
    const { taskId } = await scriptStep();
    const reply = await store.recordMessage({ device: device(), requestId, speaker: "venom", text: "Here is my plan.", taskId });
    expect(reply.kind).toBe("plan");
  });

  it("refuses a question without its step, a step of another task, and a question in the user's words", async () => {
    const first = await scriptStep();
    const second = await scriptStep();
    await expect(app`
      insert into messages (account_id, device_id, request_id, speaker, kind, text, task_id)
      values (${account.accountId}, ${account.deviceId}, ${requestId}, 'venom', 'question', 'Sure?', ${first.taskId})
    `).rejects.toMatchObject({ code: "23514" });
    await expect(app`
      insert into messages (account_id, device_id, request_id, speaker, kind, text, task_id, step_id)
      values (${account.accountId}, ${account.deviceId}, ${requestId}, 'venom', 'question', 'Sure?', ${first.taskId}, ${second.stepId})
    `).rejects.toMatchObject({ code: "23503" });
    await expect(app`
      insert into messages (account_id, device_id, request_id, speaker, kind, text, task_id, step_id)
      values (${account.accountId}, ${account.deviceId}, ${requestId}, 'user', 'question', 'Sure?', ${first.taskId}, ${first.stepId})
    `).rejects.toMatchObject({ code: "23514" });
    await expect(app`
      insert into messages (account_id, device_id, request_id, speaker, kind, text)
      values (${account.accountId}, ${account.deviceId}, ${requestId}, 'venom', 'chatter', 'Hi')
    `).rejects.toMatchObject({ code: "23514" });
  });
});

describe("a step's output", () => {
  it("keeps up to 16,000 characters of what a script printed, and no more", async () => {
    const { stepId } = await scriptStep();
    const kept = await app`update steps set output = ${"x".repeat(16000)} where id = ${stepId}`;
    expect(kept.count).toBe(1);
    await expect(app`update steps set output = ${"x".repeat(16001)} where id = ${stepId}`).rejects.toMatchObject({ code: "23514" });
  });
});
