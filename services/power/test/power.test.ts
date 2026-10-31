import { EngineId, type TokenUsage } from "@venom/contracts";
import { connect, type DeviceRef } from "@venom/db";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPower, PowerError, type Availability, type Power } from "../src/index.ts";

const everyEngine: Availability = new Set(EngineId.options);
const usage = (cost_micro_usd: number): TokenUsage => ({ input_tokens: 1800, output_tokens: 300, cost_micro_usd });

let database: TestDatabase;
let owner: Sql;
let app: Sql;
let power: Power;
let device: DeviceRef;
let email: string;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 2 });
  app = connect(database.appUrl, { max: 5 });
  power = createPower({ sql: app, freeDailyAnswers: 3 });
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
  await database.drop();
});

beforeEach(async () => {
  const account = await insertAccountWithDevice(owner);
  device = { id: account.deviceId, account_id: account.accountId };
  email = account.email;
});

async function refusal(work: Promise<unknown>): Promise<PowerError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PowerError);
  return error as PowerError;
}

describe("power", () => {
  it("starts every account on Dove with no power and a full free allowance", async () => {
    expect(await power.status(device.account_id)).toMatchObject({
      engine: "dove",
      engine_class: "free",
      balance: 0,
      free_daily_answers: 3,
      free_used_today: 0,
      answers_left: 3,
      answers_left_exact: true,
    });
  });

  it("counts free answers without spending power and stops at the daily allowance", async () => {
    for (let answer = 0; answer < 3; answer += 1) {
      expect(await power.admit(device.account_id, everyEngine)).toBe("dove");
      await power.charge({ device, requestId: uuidv7(), engine: "dove", model: "google/gemini-2.5-flash-lite", usage: usage(90) });
    }
    const status = await power.status(device.account_id);
    expect(status).toMatchObject({ balance: 0, free_used_today: 3, answers_left: 0 });
    expect(new Date(status.free_resets_at).getUTCHours()).toBe(0);

    const refused = await refusal(power.admit(device.account_id, everyEngine));
    expect(refused.statusCode).toBe(402);
    expect(refused.code).toBe("out_of_power");
    expect(refused.message).toContain("free answers with Dove");
  });

  it("refuses a paid engine when the balance is empty", async () => {
    await power.choose(device, uuidv7(), "utopia", everyEngine);
    const refused = await refusal(power.admit(device.account_id, everyEngine));
    expect(refused.code).toBe("out_of_power");
    expect(refused.message).toContain("out of power for Utopia");
  });

  it("spends power from the real cost and estimates answers left from real answers", async () => {
    await power.grant({ email, units: 1000, note: "Test grant" });
    await power.choose(device, uuidv7(), "titan", everyEngine);
    expect(await power.status(device.account_id)).toMatchObject({ balance: 1000, answers_left: 9, answers_left_exact: false });

    expect(await power.admit(device.account_id, everyEngine)).toBe("titan");
    const after = await power.charge({
      device,
      requestId: uuidv7(),
      engine: "titan",
      model: "anthropic/claude-sonnet-5.5",
      usage: usage(7_950),
    });
    expect(after).toMatchObject({ balance: 920, answers_left: 11, answers_left_exact: false });
  });

  it("charges one request only once", async () => {
    await power.grant({ email, units: 500, note: "Test grant" });
    const requestId = uuidv7();
    const charge = { device, requestId, engine: "turbo", model: "anthropic/claude-haiku-5.5", usage: usage(640) } as const;
    await power.charge(charge);
    expect((await power.charge(charge)).balance).toBe(493);
  });

  it("lists only available engines without their models and remembers the choice", async () => {
    const available: Availability = new Set(["dove", "titan"]);
    await power.choose(device, uuidv7(), "titan", available);
    const list = await power.engines(device.account_id, available);
    expect(list.current).toBe("titan");
    expect(list.engines.map((engine) => engine.id)).toEqual(["dove", "titan"]);
    expect(Object.keys(list.engines[0] ?? {})).not.toContain("models");
  });

  it("refuses to choose or use an engine that is not available", async () => {
    const onlyDove: Availability = new Set(["dove"]);
    expect((await refusal(power.choose(device, uuidv7(), "nova", onlyDove))).code).toBe("conflict");
    await power.choose(device, uuidv7(), "nova", everyEngine);
    expect((await refusal(power.admit(device.account_id, onlyDove))).message).toContain("Nova is not available");
  });

  it("records engine choices and grants in the audit log", async () => {
    await power.choose(device, uuidv7(), "comet", everyEngine);
    await power.grant({ email, units: 50, note: "Welcome" });
    const rows = await owner<{ action: string }[]>`
      select action from audit_log where account_id = ${device.account_id} order by id
    `;
    expect(rows.map((row) => row.action)).toEqual(["engine.chosen", "power.granted"]);
  });

  it("refuses grants that are not positive or for an unknown email", async () => {
    await expect(power.grant({ email, units: 0, note: "Nothing" })).rejects.toThrow(RangeError);
    expect((await refusal(power.grant({ email: "nobody@venom.test", units: 10, note: "Lost" }))).code).toBe("not_found");
  });

  it("keeps the ledger append-only, even for the database owner", async () => {
    await power.grant({ email, units: 10, note: "Kept" });
    await expect(owner`update power_ledger set units = 999999 where account_id = ${device.account_id}`).rejects.toThrow(/append-only/);
    await expect(owner`delete from power_ledger where account_id = ${device.account_id}`).rejects.toThrow(/append-only/);
    await expect(app`update power_ledger set units = 1`).rejects.toThrow(/permission denied/);
  });
});
