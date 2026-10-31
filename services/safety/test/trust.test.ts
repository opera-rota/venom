import { connect, type DeviceRef } from "@venom/db";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTrust, liveChallengeText, newKeyPair, signText, type Trust } from "../src/index.ts";

let database: TestDatabase;
let owner: Sql;
let sql: Sql;
let trust: Trust;
const server = newKeyPair();

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  sql = connect(database.appUrl, { max: 2 });
  trust = createTrust({ sql, serverKey: server.publicKey });
});

afterAll(async () => {
  await Promise.all([owner?.end(), sql?.end()]);
  await database?.drop();
});

async function device(): Promise<DeviceRef> {
  const created = await insertAccountWithDevice(owner);
  return { id: created.deviceId, account_id: created.accountId };
}

describe("device trust", () => {
  it("enrolls a key once, then proves a fresh challenge only once", async () => {
    const here = await device();
    const pair = newKeyPair();
    await expect(trust.challenge(here)).rejects.toMatchObject({ code: "device_key_missing" });
    expect(await trust.enroll(here, pair.publicKey, uuidv7())).toEqual({ device_id: here.id, server_key: server.publicKey });
    expect(await trust.enroll(here, pair.publicKey, uuidv7())).toEqual({ device_id: here.id, server_key: server.publicKey });
    await expect(trust.enroll(here, newKeyPair().publicKey, uuidv7())).rejects.toMatchObject({ statusCode: 409 });

    const challenge = await trust.challenge(here);
    const signature = signText(pair, liveChallengeText(here.id, challenge.challenge_id, challenge.nonce));
    expect(await trust.prove(here, challenge.challenge_id, signature)).toBe(true);
    expect(await trust.prove(here, challenge.challenge_id, signature)).toBe(false);

    const other = await trust.challenge(here);
    const forged = signText(newKeyPair(), liveChallengeText(here.id, other.challenge_id, other.nonce));
    expect(await trust.prove(here, other.challenge_id, forged)).toBe(false);
  });
});
