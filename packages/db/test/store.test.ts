import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { connect, createStore, type DeviceRef, type Store } from "../src/index.ts";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let store: Store;
let device: DeviceRef;

beforeAll(async () => {
  database = await createTestDatabase();
  const owner = connect(database.migratorUrl, { max: 1 });
  const account = await insertAccountWithDevice(owner);
  await owner.end();
  device = { id: account.deviceId, account_id: account.accountId };
  store = createStore(database.appUrl);
});

afterAll(async () => {
  await store?.close();
  await database?.drop();
});

describe("message store", () => {
  it("records messages with an audit entry and returns them in order", async () => {
    const requestId = uuidv7();
    const first = await store.recordMessage({ device, requestId, speaker: "user", text: "first" });
    const second = await store.recordMessage({ device, requestId, speaker: "venom", text: "second" });

    expect(first).toMatchObject({ speaker: "user", text: "first", device_id: device.id });
    expect((await store.listConversation(device.account_id, 50)).messages.map((m) => m.id)).toEqual([first.id, second.id]);
    expect((await store.listConversation(device.account_id, 1)).messages.map((m) => m.id)).toEqual([second.id]);

    const owner = connect(database.migratorUrl, { max: 1 });
    const audit = await owner`
      select action, subject_id, detail from audit_log where request_id = ${requestId} order by id
    `;
    await owner.end();
    expect(audit).toEqual([
      { action: "message.recorded", subject_id: first.id, detail: { speaker: "user", characters: 5 } },
      { action: "message.recorded", subject_id: second.id, detail: { speaker: "venom", characters: 6 } },
    ]);
  });

  it("lists the questions VENOM has not answered yet, within the listed messages", async () => {
    const owner = connect(database.migratorUrl, { max: 1 });
    const fresh = await insertAccountWithDevice(owner);
    await owner.end();
    const asker = { id: fresh.deviceId, account_id: fresh.accountId };

    const answeredId = uuidv7();
    await store.recordMessage({ device: asker, requestId: answeredId, speaker: "user", text: "Answered question" });
    await store.recordMessage({ device: asker, requestId: answeredId, speaker: "venom", text: "The answer" });
    const waitingId = uuidv7();
    const waiting = await store.recordMessage({ device: asker, requestId: waitingId, speaker: "user", text: "Waiting question" });

    const conversation = await store.listConversation(asker.account_id, 50);
    expect(conversation.messages.map((message) => message.text)).toEqual(["Answered question", "The answer", "Waiting question"]);
    expect(conversation.unanswered).toEqual([{ request_id: waitingId, message_id: waiting.id }]);
    expect((await store.listConversation(device.account_id, 50)).unanswered.every((question) => question.request_id !== waitingId)).toBe(true);
  });

  it("refuses a message for a device that belongs to another account", async () => {
    const owner = connect(database.migratorUrl, { max: 1 });
    const other = await insertAccountWithDevice(owner);
    await owner.end();
    await expect(
      store.recordMessage({ device: { id: other.deviceId, account_id: device.account_id }, requestId: uuidv7(), speaker: "user", text: "x" }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("gives the conversation before a message, oldest first, for that account only", async () => {
    const owner = connect(database.migratorUrl, { max: 1 });
    const other = await insertAccountWithDevice(owner);
    await owner.end();
    const stranger = { id: other.deviceId, account_id: other.accountId };

    const before = await store.recordMessage({ device, requestId: uuidv7(), speaker: "user", text: "What is a thread?" });
    await store.recordMessage({ device, requestId: uuidv7(), speaker: "venom", text: "One path of execution." });
    await store.recordMessage({ device: stranger, requestId: uuidv7(), speaker: "user", text: "Someone else" });
    const pivot = await store.recordMessage({ device, requestId: uuidv7(), speaker: "user", text: "And a mutex?" });
    await store.recordMessage({ device, requestId: uuidv7(), speaker: "user", text: "Later" });

    const history = await store.conversationBefore(device.account_id, pivot.id, 2);
    expect(history).toEqual([
      { speaker: "user", text: "What is a thread?" },
      { speaker: "venom", text: "One path of execution." },
    ]);
    expect(await store.conversationBefore(stranger.account_id, pivot.id, 10)).toEqual([]);
    expect(before.id).not.toBe(pivot.id);
  });

  it("finds the question of a request and whether it was answered", async () => {
    const requestId = uuidv7();
    const question = await store.recordMessage({ device, requestId, speaker: "user", text: "Explain what a mutex is" });

    expect(await store.findRequest(device.account_id, requestId)).toEqual({ question, answered: false });
    expect(await store.findRequest(device.account_id, uuidv7())).toBeNull();

    const reply = await store.recordMessage({
      device,
      requestId,
      speaker: "venom",
      text: "A lock.",
      answer: { model: "claude-test", intent: "question" },
    });
    expect(await store.findRequest(device.account_id, requestId)).toEqual({ question, answered: true });

    const owner = connect(database.migratorUrl, { max: 1 });
    const [audit] = await owner`select detail from audit_log where subject_id = ${reply.id}`;
    await owner.end();
    expect(audit?.["detail"]).toEqual({ speaker: "venom", characters: 7, model: "claude-test", intent: "question" });
  });
});
