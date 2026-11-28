import type { HowToStep, MoveTarget, ScreenMove } from "@venom/contracts";
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

async function finishedGoal(device: DeviceRef): Promise<string> {
  const [task] = await owner<{ id: string }[]>`
    insert into tasks (account_id, origin_device_id, target_device_id, request_text, status)
    values (${device.account_id}, ${device.id}, ${device.id}, 'Open Calculator and add the numbers', 'completed')
    returning id
  `;
  return task?.id ?? "";
}

const steps: HowToStep[] = [
  { number: 1, kind: "open", label: "Calculator", said: "Open the Calculator app.", note: null },
  { number: 2, kind: "type", label: "“1+2+3”", said: "Type the sum.", note: null },
  { number: 3, kind: "key", label: "Enter", said: "Press Enter to see the total.", note: null },
];

function save(device: DeviceRef, taskId: string | null, name = "Add numbers") {
  return store.saveHowTo({ device, requestId: uuidv7(), taskId, name, app: "Calculator", learned: taskId === null ? "tell" : "job", seconds: 40, steps });
}

describe("how-tos VENOM keeps", () => {
  it("saves a finished job once, and lists pinned how-tos first, then the newest", async () => {
    const device = await freshDevice();
    const taskId = await finishedGoal(device);
    const first = await save(device, taskId);
    expect(first.kind).toBe("saved");
    expect(await save(device, taskId)).toEqual({ kind: "exists" });

    const second = await save(device, null, "Weekly report");
    if (first.kind !== "saved" || second.kind !== "saved") {
      throw new Error("both should be saved");
    }
    expect(first.howto).toMatchObject({ name: "Add numbers", learned: "job", task_id: taskId, pinned: false, applied: 0, worked: 0, seconds: 40 });
    expect((await store.howtos(device.account_id)).map((howto) => howto.name)).toEqual(["Weekly report", "Add numbers"]);

    const pinned = await store.changeHowTo({ device, requestId: uuidv7(), howtoId: first.howto.id, pinned: true });
    expect(pinned?.pinned).toBe(true);
    expect((await store.howtos(device.account_id)).map((howto) => howto.name)).toEqual(["Add numbers", "Weekly report"]);
  });

  it("renames, writes and clears a note on one step, and never touches another account", async () => {
    const device = await freshDevice();
    const stranger = await freshDevice();
    const saved = await save(device, null);
    if (saved.kind !== "saved") {
      throw new Error("should be saved");
    }
    const target = { requestId: uuidv7(), howtoId: saved.howto.id };

    expect(await store.changeHowTo({ device: stranger, ...target, name: "Mine now" })).toBeNull();
    expect(await store.noteHowToStep({ device: stranger, ...target, number: 2, note: "x" })).toEqual({ kind: "gone" });
    expect(await store.forgetHowTo({ device: stranger, ...target })).toBe(false);

    expect((await store.changeHowTo({ device, ...target, name: "Sum it up" }))?.name).toBe("Sum it up");
    const noted = await store.noteHowToStep({ device, ...target, number: 2, note: "Use the keyboard, not the buttons." });
    expect(noted.kind === "noted" ? noted.howto.steps.map((step) => step.note) : []).toEqual([null, "Use the keyboard, not the buttons.", null]);
    expect(await store.noteHowToStep({ device, ...target, number: 9, note: "x" })).toEqual({ kind: "no_step" });
    const cleared = await store.noteHowToStep({ device, ...target, number: 2, note: null });
    expect(cleared.kind === "noted" ? cleared.howto.steps[1]?.note : "missing").toBeNull();

    expect(await store.forgetHowTo({ device, ...target })).toBe(true);
    expect(await store.howtos(device.account_id)).toEqual([]);
  });

  it("writes no names, notes or steps into the audit log", async () => {
    const device = await freshDevice();
    const saved = await save(device, null, "Secret surprise");
    if (saved.kind !== "saved") {
      throw new Error("should be saved");
    }
    const requestId = uuidv7();
    await store.noteHowToStep({ device, requestId, howtoId: saved.howto.id, number: 1, note: "Party on Friday" });
    const entries = await owner<{ action: string; detail: unknown }[]>`select action, detail from audit_log where subject_id = ${saved.howto.id} order by occurred_at`;
    expect(entries).toEqual([
      { action: "howto.saved", detail: { learned: "tell", steps: 3 } },
      { action: "howto.noted", detail: { step: 1, characters: 15 } },
    ]);
  });

  it("refuses broken how-tos at the database itself", async () => {
    const device = await freshDevice();
    await expect(owner`
      insert into howtos (account_id, device_id, name, learned, steps) values (${device.account_id}, ${device.id}, 'Empty', 'tell', '[]'::jsonb)
    `).rejects.toThrow();
    await expect(owner`
      insert into howtos (account_id, device_id, name, learned, worked, steps) values (${device.account_id}, ${device.id}, 'Lucky', 'tell', 2, '[{}]'::jsonb)
    `).rejects.toThrow();
  });

  it("counts each apply once, follows it with its notes, and counts worked only once per job", async () => {
    const device = await freshDevice();
    const stranger = await freshDevice();
    const saved = await save(device, null);
    if (saved.kind !== "saved") {
      throw new Error("should be saved");
    }
    const howtoId = saved.howto.id;
    await store.noteHowToStep({ device, requestId: uuidv7(), howtoId, number: 3, note: "Press Enter twice." });
    const taskId = await finishedGoal(device);

    expect(await store.startHowTo({ device: stranger, requestId: uuidv7(), howtoId, taskId, stepByStep: false })).toBeNull();
    expect(await store.howTo(stranger.account_id, howtoId)).toBeNull();
    const started = await store.startHowTo({ device, requestId: uuidv7(), howtoId, taskId, stepByStep: true });
    expect(started).toMatchObject({ applied: 1, worked: 0 });

    const run = { accountId: device.account_id, taskId };
    expect(await store.followedHowTo({ accountId: stranger.account_id, taskId })).toBeNull();
    expect(await store.followedHowTo(run)).toEqual({ name: "Add numbers", step_by_step: true, steps: steps.map((step) => (step.number === 3 ? { ...step, note: "Press Enter twice." } : step)) });

    expect(await store.howToWorked({ accountId: stranger.account_id, taskId })).toBeNull();
    expect(await store.howToWorked(run)).toMatchObject({ applied: 1, worked: 1 });
    expect(await store.howToWorked(run)).toBeNull();
    expect(await store.howToWorked({ accountId: device.account_id, taskId: await finishedGoal(device) })).toBeNull();
    expect((await store.howTo(device.account_id, howtoId))?.worked).toBe(1);

    const entries = await owner<{ action: string; detail: unknown }[]>`select action, detail from audit_log where subject_id = ${howtoId} and action = 'howto.applied'`;
    expect(entries).toEqual([{ action: "howto.applied", detail: { task_id: taskId, step_by_step: true } }]);

    expect(await store.forgetHowTo({ device, requestId: uuidv7(), howtoId })).toBe(true);
    expect(await store.followedHowTo(run)).toBeNull();
  });

  it("replays the finished moves of the job a how-to was learned from, with each step's note and target", async () => {
    const device = await freshDevice();
    const stranger = await freshDevice();
    const source = await finishedGoal(device);
    const moved = (number: number, status: string, move: ScreenMove, target: MoveTarget | null) => owner`
      insert into moves (task_id, account_id, number, intent, seen, move, status, detail, target, started_at, finished_at)
      values (${source}, ${device.account_id}, ${number}, 'A move.', 'The screen.', ${owner.json(move)}, ${status}, 'It ran.', ${target === null ? null : owner.json(target)}, clock_timestamp(), clock_timestamp())
    `;
    await moved(1, "done", { name: "open", app: "Calculator", open: null }, null);
    await moved(2, "failed", { name: "click", mark: 4, point: null, double: false }, { kind: "button", name: "Six", window: "Calculator" });
    await moved(3, "done", { name: "type", text: "1+2+3", mark: null, enter: false }, { kind: null, name: null, window: "Calculator" });
    await moved(4, "done", { name: "key", key: "enter" }, { kind: null, name: null, window: "Calculator" });
    const saved = await save(device, source);
    const told = await save(device, null, "Told");
    if (saved.kind !== "saved" || told.kind !== "saved") {
      throw new Error("should be saved");
    }
    await store.noteHowToStep({ device, requestId: uuidv7(), howtoId: saved.howto.id, number: 2, note: "Use the buttons." });

    const taskId = await finishedGoal(device);
    await store.startHowTo({ device, requestId: uuidv7(), howtoId: saved.howto.id, taskId, stepByStep: false });
    expect(await store.howToReplay({ accountId: stranger.account_id, taskId })).toEqual([]);
    expect(await store.howToReplay({ accountId: device.account_id, taskId })).toEqual([
      { number: 1, said: "Open the Calculator app.", note: null, move: { name: "open", app: "Calculator", open: null }, effects: [], target: null },
      { number: 2, said: "Type the sum.", note: "Use the buttons.", move: { name: "type", text: "1+2+3", mark: null, enter: false }, effects: [], target: { kind: null, name: null, window: "Calculator" } },
      { number: 3, said: "Press Enter to see the total.", note: null, move: { name: "key", key: "enter" }, effects: [], target: { kind: null, name: null, window: "Calculator" } },
    ]);

    const toldTask = await finishedGoal(device);
    await store.startHowTo({ device, requestId: uuidv7(), howtoId: told.howto.id, taskId: toldTask, stepByStep: false });
    expect(await store.howToReplay({ accountId: device.account_id, taskId: toldTask })).toEqual([]);

    await moved(5, "done", { name: "pause", seconds: 1 }, null);
    expect(await store.howToReplay({ accountId: device.account_id, taskId })).toEqual([]);
  });
});
