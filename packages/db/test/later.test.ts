import { laterLimits } from "@venom/contracts";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, createStore, type DeviceRef, type Store } from "../src/index.ts";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let owner: Sql;
let store: Store;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  store = createStore(database.appUrl);
});

afterAll(async () => {
  await store?.close();
  await owner?.end();
  await database?.drop();
});

async function freshDevice(): Promise<DeviceRef> {
  const account = await insertAccountWithDevice(owner);
  return { id: account.deviceId, account_id: account.accountId };
}

describe("things VENOM keeps for later", () => {
  it("keeps an item unseen, lists the newest first, and marks it seen once", async () => {
    const device = await freshDevice();
    const first = await store.keepForLater({ device, requestId: uuidv7(), title: "Weather in Kigali", body: "Sunny, 26 °C." });
    const second = await store.keepForLater({ device, requestId: uuidv7(), title: "Bus times", body: "Every 15 minutes." });

    expect(first.item).toMatchObject({ title: "Weather in Kigali", seen_at: null, task_id: null });
    expect((await store.laterItems(device.account_id)).map((item) => item.id)).toEqual([second.item.id, first.item.id]);

    const seen = await store.markLaterSeen({ device, requestId: uuidv7(), itemId: first.item.id });
    expect(seen?.seen_at).not.toBeNull();
    const again = await store.markLaterSeen({ device, requestId: uuidv7(), itemId: first.item.id });
    expect(again?.seen_at).toBe(seen?.seen_at);
  });

  it("removes an item for good, and never touches another account's items", async () => {
    const device = await freshDevice();
    const stranger = await freshDevice();
    const { item } = await store.keepForLater({ device, requestId: uuidv7(), title: "Notes", body: "Keep this." });

    expect(await store.removeLater({ device: stranger, requestId: uuidv7(), itemId: item.id })).toBe(false);
    expect(await store.markLaterSeen({ device: stranger, requestId: uuidv7(), itemId: item.id })).toBeNull();
    expect(await store.removeLater({ device, requestId: uuidv7(), itemId: item.id })).toBe(true);
    expect(await store.laterItems(device.account_id)).toEqual([]);
  });

  it(`keeps only the newest ${laterLimits.items} items and says which were dropped`, async () => {
    const device = await freshDevice();
    const kept: string[] = [];
    for (let index = 0; index < laterLimits.items; index++) {
      kept.push((await store.keepForLater({ device, requestId: uuidv7(), title: `Item ${index}`, body: "x" })).item.id);
    }
    const newest = await store.keepForLater({ device, requestId: uuidv7(), title: "One more", body: "x" });

    expect(newest.dropped).toEqual([kept[0]]);
    const listed = await store.laterItems(device.account_id);
    expect(listed).toHaveLength(laterLimits.items);
    expect(listed[0]?.id).toBe(newest.item.id);
  });

  it("writes only sizes and ids in the audit log", async () => {
    const device = await freshDevice();
    const requestId = uuidv7();
    const { item } = await store.keepForLater({ device, requestId, title: "Secret plan", body: "Surprise party on Friday." });
    const [entry] = await owner`select action, subject_id, detail from audit_log where request_id = ${requestId}`;
    expect(entry).toEqual({ action: "later.kept", subject_id: item.id, detail: { characters: 25 } });
  });

  it("refuses a blank title or body at the database itself", async () => {
    const device = await freshDevice();
    await expect(owner`
      insert into later_items (account_id, device_id, title, body) values (${device.account_id}, ${device.id}, '  ', 'x')
    `).rejects.toMatchObject({ code: "23514" });
    await expect(owner`
      insert into later_items (account_id, device_id, title, body) values (${device.account_id}, ${device.id}, 'Title', ${"x".repeat(32001)})
    `).rejects.toMatchObject({ code: "23514" });
  });
});
