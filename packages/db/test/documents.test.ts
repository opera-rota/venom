import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, createStore, type DeviceRef, type Store } from "../src/index.ts";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "../src/testing.ts";

const shoppingList = { title: "Shopping list", body: "- Milk\n- Bread\n- Eggs" };

let database: TestDatabase;
let store: Store;
let app: Sql;
let device: DeviceRef;

beforeAll(async () => {
  database = await createTestDatabase();
  const owner = connect(database.migratorUrl, { max: 1 });
  const account = await insertAccountWithDevice(owner);
  await owner.end();
  device = { id: account.deviceId, account_id: account.accountId };
  store = createStore(database.appUrl);
  app = connect(database.appUrl, { max: 1 });
});

afterAll(async () => {
  await app?.end();
  await store?.close();
  await database?.drop();
});

describe("a document VENOM hands over in the chat", () => {
  it("is kept with the answer and comes back in the conversation", async () => {
    const requestId = uuidv7();
    await store.recordMessage({ device, requestId, speaker: "user", text: "Write me a shopping list" });
    const answer = await store.recordMessage({ device, requestId, speaker: "venom", text: "Here it is, buddy.", document: shoppingList });

    expect(answer.document).toEqual(shoppingList);
    const listed = await store.listConversation(device.account_id, 50);
    expect(listed.messages.find((message) => message.id === answer.id)?.document).toEqual(shoppingList);
    expect(listed.messages.find((message) => message.speaker === "user")?.document).toBeNull();
  });

  it("reaches the brain's history as the answer followed by the whole document", async () => {
    const requestId = uuidv7();
    await store.recordMessage({ device, requestId, speaker: "user", text: "A packing list please" });
    await store.recordMessage({ device, requestId, speaker: "venom", text: "Done.", document: { title: "Packing", body: "- Shoes" } });
    const next = uuidv7();
    const asked = await store.recordMessage({ device, requestId: next, speaker: "user", text: "Add socks" });

    const history = await store.conversationBefore(device.account_id, asked.id, 2);
    expect(history).toEqual([
      { speaker: "user", text: "A packing list please" },
      { speaker: "venom", text: "Done.\n\n<document>\n# Packing\n- Shoes\n</document>" },
    ]);
  });

  it("counts the document's characters in the audit log, never its words", async () => {
    const requestId = uuidv7();
    const answer = await store.recordMessage({ device, requestId, speaker: "venom", text: "Here.", document: shoppingList });
    const owner = connect(database.migratorUrl, { max: 1 });
    const [entry] = await owner`select detail from audit_log where subject_id = ${answer.id}`;
    await owner.end();
    expect(entry?.["detail"]).toEqual({ speaker: "venom", characters: 5, document_characters: shoppingList.body.length });
  });

  it("is refused on a user message, on a plan, and in any other shape", async () => {
    const requestId = uuidv7();
    await expect(app`
      insert into messages (account_id, device_id, request_id, speaker, text, document)
      values (${device.account_id}, ${device.id}, ${requestId}, 'user', 'Mine', ${app.json(shoppingList)})
    `).rejects.toMatchObject({ code: "23514" });
    for (const broken of [{ title: "List" }, { title: "", body: "x" }, { title: "List", body: "x", extra: true }, { title: "List", body: "x".repeat(32001) }]) {
      await expect(app`
        insert into messages (account_id, device_id, request_id, speaker, text, document)
        values (${device.account_id}, ${device.id}, ${requestId}, 'venom', 'Here', ${app.json(broken)})
      `).rejects.toMatchObject({ code: "23514" });
    }
  });
});
