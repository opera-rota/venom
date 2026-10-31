import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "../src/index.ts";
import { createTestDatabase, insertAccountWithDevice, type TestAccount, type TestDatabase } from "../src/testing.ts";

let database: TestDatabase;
let owner: Sql;
let app: Sql;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 2 });
  app = connect(database.appUrl, { max: 4 });
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
  await database?.drop();
});

async function said(account: TestAccount, text: string): Promise<{ requestId: string; messageIds: string[] }> {
  const requestId = uuidv7();
  const rows = await app<{ id: string }[]>`
    insert into messages (account_id, device_id, request_id, speaker, text)
    values
      (${account.accountId}, ${account.deviceId}, ${requestId}, 'user', ${text}),
      (${account.accountId}, ${account.deviceId}, ${requestId}, 'venom', 'I will remember that.')
    returning id
  `;
  return { requestId, messageIds: rows.map((row) => row.id).sort() };
}

async function remember(account: TestAccount, content: string, requestId: string | null = null): Promise<string> {
  const [row] = await app<{ id: string }[]>`
    insert into memories (account_id, type, content, source, source_request_id)
    values (${account.accountId}, 'fact', ${content}, ${requestId === null ? "settings" : "chat"}, ${requestId})
    returning id
  `;
  if (row === undefined) {
    throw new Error("Memory insert returned no row");
  }
  return row.id;
}

describe("memories in the database", () => {
  it("stores a vector and finds the closest one by meaning", async () => {
    const account = await insertAccountWithDevice(owner);
    const near = await remember(account, "My sister Ana's birthday is on 12 March");
    const far = await remember(account, "My car is a blue Toyota");
    await app`update memories set embedding = '[1,0,0]', embedding_model = 'test' where id = ${near}`;
    await app`update memories set embedding = '[0,0,1]', embedding_model = 'test' where id = ${far}`;

    const rows = await app<{ id: string }[]>`
      select id from memories where account_id = ${account.accountId} order by embedding <=> '[0.9,0.1,0]'::vector
    `;
    expect(rows.map((row) => row.id)).toEqual([near, far]);
  });

  it("keeps searchable words for every memory", async () => {
    const account = await insertAccountWithDevice(owner);
    await remember(account, "My sister Ana's birthday is on 12 March");
    const [row] = await app<{ found: boolean }[]>`
      select words @@ replace(plainto_tsquery('english', 'what did I say about birthdays')::text, '&', '|')::tsquery as found
      from memories where account_id = ${account.accountId}
    `;
    expect(row?.found).toBe(true);
  });

  it("refuses a vector without the model that made it", async () => {
    const account = await insertAccountWithDevice(owner);
    const id = await remember(account, "I prefer tea");
    await expect(app`update memories set embedding = '[1,2]' where id = ${id}`).rejects.toMatchObject({ code: "23514" });
  });

  it("stops at 500 memories for one account", async () => {
    const account = await insertAccountWithDevice(owner);
    await owner`
      insert into memories (account_id, type, content, source)
      select ${account.accountId}, 'fact', 'Fact number ' || n, 'settings' from generate_series(1, 500) n
    `;
    await expect(remember(account, "One too many")).rejects.toMatchObject({ code: "23514", constraint_name: "memories_limit" });
  });

  it("forgets a memory together with the messages where it was said", async () => {
    const account = await insertAccountWithDevice(owner);
    const { requestId, messageIds } = await said(account, "Remember that I prefer metric units");
    const kept = await said(account, "What is the weather like?");
    const id = await remember(account, "I prefer metric units", requestId);

    const [forgotten] = await app<{ spoken_request: string | null; removed_messages: string[] }[]>`
      select * from forget_memory(${account.accountId}, ${id})
    `;
    expect(forgotten).toEqual({ spoken_request: requestId, removed_messages: messageIds });

    const [left] = await owner<{ memories: string; messages: string }[]>`
      select
        (select count(*) from memories where id = ${id}) as memories,
        (select count(*) from messages where account_id = ${account.accountId}) as messages
    `;
    expect(left).toEqual({ memories: "0", messages: String(kept.messageIds.length) });
  });

  it("never forgets a memory of another account", async () => {
    const mine = await insertAccountWithDevice(owner);
    const theirs = await insertAccountWithDevice(owner);
    const id = await remember(theirs, "Their secret plan");
    expect(await app`select * from forget_memory(${mine.accountId}, ${id})`).toHaveLength(0);
    expect(await app`select id from memories where id = ${id}`).toHaveLength(1);
  });

  it.each([
    ["delete a memory", "delete from memories"],
    ["delete a message", "delete from messages"],
    ["move a memory to another account", "update memories set account_id = account_id"],
  ])("does not let the app %s directly", async (_, statement) => {
    await expect(app.unsafe(statement)).rejects.toMatchObject({ code: "42501" });
  });
});
