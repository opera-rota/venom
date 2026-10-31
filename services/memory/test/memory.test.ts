import type { DeviceRef } from "@venom/db";
import { connect } from "@venom/db";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemory, MemoryError, type Memory } from "../src/index.ts";
import { wordEmbedder, type WordEmbedder } from "../src/testing.ts";

let database: TestDatabase;
let owner: Sql;
let app: Sql;
let embedder: WordEmbedder;
let memory: Memory;
let device: DeviceRef;
const problems: unknown[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 2 });
  app = connect(database.appUrl, { max: 5 });
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
  await database.drop();
});

beforeEach(async () => {
  embedder = wordEmbedder();
  problems.length = 0;
  memory = createMemory({ sql: app, embedder, onEmbeddingProblem: (error) => problems.push(error) });
  const account = await insertAccountWithDevice(owner);
  device = { id: account.deviceId, account_id: account.accountId };
});

async function keep(type: "fact" | "preference" | "event", content: string) {
  return (await memory.save(device, uuidv7(), { type, content }, { kind: "settings" })).item;
}

async function backfillEverything(): Promise<void> {
  let rounds = 0;
  while ((await memory.backfill(uuidv7())) > 0) {
    rounds += 1;
    expect(rounds).toBeLessThan(100);
  }
}

async function contents(text: string): Promise<string[]> {
  return (await memory.recall(device.account_id, text, uuidv7())).memories.map((item) => item.content);
}

describe("the memory service", () => {
  it("saves a memory with its meaning and lists the newest first", async () => {
    await keep("fact", "My car is a blue Toyota");
    const saved = await keep("event", "My sister Ana's birthday is on 12 March");

    const list = await memory.list(device.account_id);
    expect(list.limit).toBe(500);
    expect(list.items.map((item) => item.content)).toEqual(["My sister Ana's birthday is on 12 March", "My car is a blue Toyota"]);
    expect(saved).toMatchObject({ type: "event", source: "settings", status: "active" });

    const [row] = await owner<{ embedding_model: string | null }[]>`select embedding_model from memories where id = ${saved.id}`;
    expect(row?.embedding_model).toBe("scripted-embedding");
  });

  it("recalls the right note by meaning and always includes preferences", async () => {
    await keep("preference", "I prefer metric units");
    await keep("fact", "My car is a blue Toyota");
    await keep("event", "My sister Ana's birthday is on 12 March");

    expect(await contents("What did I say about my sister's birthday?")).toEqual(["I prefer metric units", "My sister Ana's birthday is on 12 March"]);
    expect(await contents("How far is Paris from Berlin?")).toEqual(["I prefer metric units"]);
  });

  it("still recalls by words when embeddings are down, and fills the meaning in later", async () => {
    embedder.working = false;
    await keep("event", "My sister Ana's birthday is on 12 March");
    expect(await contents("When is Ana's birthday?")).toEqual(["My sister Ana's birthday is on 12 March"]);
    expect(problems.length).toBeGreaterThan(0);

    embedder.working = true;
    await backfillEverything();
    const [row] = await owner<{ embedding_model: string | null }[]>`select embedding_model from memories where account_id = ${device.account_id}`;
    expect(row?.embedding_model).toBe("scripted-embedding");
  });

  it("does not spend an embedding when there is nothing to search", async () => {
    await keep("preference", "I prefer short answers");
    const before = embedder.calls.length;
    expect(await contents("Tell me about mutexes")).toEqual(["I prefer short answers"]);
    expect(embedder.calls.length).toBe(before);
  });

  it("re-embeds memories made by an older model", async () => {
    await keep("fact", "My car is a blue Toyota");
    embedder.model = "newer-embedding";
    await contents("What car do I drive?");
    await backfillEverything();
    const [row] = await owner<{ embedding_model: string }[]>`select embedding_model from memories where account_id = ${device.account_id}`;
    expect(row?.embedding_model).toBe("newer-embedding");
  });

  it("edits a memory and recalls the new words, not the old ones", async () => {
    const item = await keep("preference", "I prefer imperial units");
    const edited = await memory.edit(device, uuidv7(), item.id, { type: "preference", content: "I prefer metric units" });
    expect(edited.content).toBe("I prefer metric units");
    expect(Date.parse(edited.updated_at)).toBeGreaterThanOrEqual(Date.parse(item.updated_at));
    expect(await contents("units")).toEqual(["I prefer metric units"]);
  });

  it("forgets a memory said in chat together with that exchange, and keeps no words in the audit log", async () => {
    const requestId = uuidv7();
    const messages = await owner<{ id: string }[]>`
      insert into messages (account_id, device_id, request_id, speaker, text)
      values
        (${device.account_id}, ${device.id}, ${requestId}, 'user', 'Remember that I prefer metric units'),
        (${device.account_id}, ${device.id}, ${requestId}, 'venom', 'Got it, metric from now on.')
      returning id
    `;
    const { item } = await memory.save(device, requestId, { type: "preference", content: "I prefer metric units" }, { kind: "chat", requestId });
    expect(await memory.spokenIn(device.account_id, requestId)).toMatchObject({ content: "I prefer metric units" });

    const forgotten = await memory.forget(device, uuidv7(), item.id);
    expect(forgotten.item_id).toBe(item.id);
    expect([...forgotten.message_ids].sort()).toEqual(messages.map((row) => row.id).sort());
    expect(await contents("units")).toEqual([]);
    expect((await memory.list(device.account_id)).items).toEqual([]);

    const audit = await owner<{ action: string; detail: Record<string, unknown> }[]>`
      select action, detail from audit_log where subject_id = ${item.id} order by id
    `;
    expect(audit.map((row) => row.action)).toEqual(["memory.saved", "memory.forgotten"]);
    expect(JSON.stringify(audit)).not.toContain("metric");
  });

  it("refuses to change or forget a memory that does not exist", async () => {
    const missing = uuidv7();
    await expect(memory.forget(device, uuidv7(), missing)).rejects.toMatchObject({ statusCode: 404, code: "not_found" });
    await expect(memory.edit(device, uuidv7(), missing, { type: "fact", content: "x y z" })).rejects.toBeInstanceOf(MemoryError);
  });

  it("says plainly when memory is full", async () => {
    await owner`
      insert into memories (account_id, type, content, source)
      select ${device.account_id}, 'fact', 'Fact number ' || n, 'settings' from generate_series(1, 500) n
    `;
    const refused = await keep("fact", "One fact too many").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(MemoryError);
    expect(refused).toMatchObject({ statusCode: 409, code: "memory_full" });
  });
});
