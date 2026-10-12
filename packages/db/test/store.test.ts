import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { connect, createStore, developmentAccount, developmentDevice, seedDevelopment, type Store } from "../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let store: Store;

beforeAll(async () => {
  database = await createTestDatabase();
  const owner = connect(database.migratorUrl, { max: 1 });
  expect(await seedDevelopment(owner)).toBe(true);
  expect(await seedDevelopment(owner)).toBe(false);
  await owner.end();
  store = createStore(database.appUrl);
});

afterAll(async () => {
  await store?.close();
  await database?.drop();
});

describe("message store", () => {
  it("finds a seeded device and ignores unknown ones", async () => {
    expect(await store.findDevice(developmentDevice.id)).toEqual({
      id: developmentDevice.id,
      account_id: developmentAccount.id,
    });
    expect(await store.findDevice(uuidv7())).toBeNull();
  });

  it("records messages with an audit entry and returns them in order", async () => {
    const device = { id: developmentDevice.id, account_id: developmentAccount.id };
    const requestId = uuidv7();
    const first = await store.recordMessage({ device, requestId, speaker: "user", text: "first" });
    const second = await store.recordMessage({ device, requestId, speaker: "venom", text: "second" });

    expect(first).toMatchObject({ speaker: "user", text: "first", device_id: device.id });
    expect((await store.listMessages(device.account_id, 50)).map((m) => m.id)).toEqual([first.id, second.id]);
    expect((await store.listMessages(device.account_id, 1)).map((m) => m.id)).toEqual([second.id]);

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
});
