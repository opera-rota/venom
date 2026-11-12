import { connect, type DeviceRef } from "@venom/db";
import { createTestDatabase, insertAccountWithDevice, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoals, createTasks, type Goals, type Proposal, type Tasks } from "../src/index.ts";

let database: TestDatabase;
let owner: Sql;
let sql: Sql;
let goals: Goals;
let tasks: Tasks;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = connect(database.migratorUrl, { max: 1 });
  sql = connect(database.appUrl, { max: 4 });
  goals = createGoals({ sql });
  tasks = createTasks({ sql });
});

afterAll(async () => {
  await Promise.all([owner?.end(), sql?.end()]);
  await database?.drop();
});

async function device(): Promise<DeviceRef> {
  const created = await insertAccountWithDevice(owner);
  return { id: created.deviceId, account_id: created.accountId };
}

const typing: Proposal = {
  intent: "Type the shopping list into the text editor",
  seen: "Notepad is open with an empty page.",
  move: { name: "type", text: "Milk", mark: 1, enter: false },
  effects: [],
  verdict: "go",
  detail: null,
};

const signingIn: Proposal = {
  intent: "Click Log in",
  seen: "Wikipedia is open.",
  move: { name: "click", mark: 3, point: null, double: false },
  effects: ["uses_credential"],
  verdict: "ask",
  detail: null,
};

describe("a goal is reached one counted move at a time", () => {
  it("starts running at once, counts finished moves and ends with VENOM's words", async () => {
    const here = await device();
    const task = await goals.begin(here, here.id, "Open Notepad and write a list", uuidv7());
    expect(task).toMatchObject({ kind: "goal", status: "running", plan: [], moves: 0, result: null });

    const first = await goals.propose(here.account_id, task.id, typing, uuidv7());
    expect(first?.move).toMatchObject({ number: 1, status: "running", detail: null, finished_at: null });
    const done = await goals.finish(here.account_id, first?.move.id ?? "", "done", "Typed 4 characters and read them back.", uuidv7());
    expect(done?.task.moves).toBe(1);
    expect(await goals.finish(here.account_id, first?.move.id ?? "", "failed", "Again", uuidv7())).toBeNull();

    const second = await goals.propose(here.account_id, task.id, { ...typing, intent: "Press Enter" }, uuidv7());
    expect(second?.move.number).toBe(2);
    await goals.finish(here.account_id, second?.move.id ?? "", "failed", "The window lost focus.", uuidv7());
    expect((await goals.history(here.account_id, task.id)).map((past) => past.outcome)).toEqual(["done", "failed"]);

    const ended = await goals.end(here.account_id, task.id, "completed", "Done. The list is in Notepad.", uuidv7());
    expect(ended).toMatchObject({ status: "completed", moves: 1, result: "Done. The list is in Notepad." });
    expect(await goals.open(here.account_id)).toBeNull();
  });

  it("waits for a yes before a sensitive move, and a no cancels the goal", async () => {
    const here = await device();
    const task = await goals.begin(here, here.id, "Log in to Wikipedia", uuidv7());
    const asked = await goals.propose(here.account_id, task.id, signingIn, uuidv7());
    expect(asked?.move.status).toBe("asking");
    expect(asked?.task.status).toBe("awaiting_confirmation");
    expect((await goals.open(here.account_id))?.asking?.id).toBe(asked?.move.id);
    expect(await goals.propose(here.account_id, task.id, typing, uuidv7())).toBeNull();

    const declined = await goals.answer(here, task.id, asked?.move.id ?? "", "decline", uuidv7());
    expect(declined.move).toMatchObject({ status: "declined", detail: "You said no, so this move never ran." });
    expect(declined.task).toMatchObject({ status: "cancelled", result: "Cancelled because you said no to a move." });
    await expect(goals.answer(here, task.id, asked?.move.id ?? "", "approve", uuidv7())).rejects.toMatchObject({ statusCode: 409 });
  });

  it("runs a move after a yes", async () => {
    const here = await device();
    const task = await goals.begin(here, here.id, "Log in to Wikipedia", uuidv7());
    const asked = await goals.propose(here.account_id, task.id, signingIn, uuidv7());
    const approved = await goals.answer(here, task.id, asked?.move.id ?? "", "approve", uuidv7());
    expect(approved.move.status).toBe("running");
    expect(approved.task.status).toBe("running");
  });

  it("records a refused move as finished and waits for her word", async () => {
    const here = await device();
    const task = await goals.begin(here, here.id, "Sign in", uuidv7());
    const refused = await goals.propose(here.account_id, task.id, { ...typing, verdict: "refuse", detail: "VENOM never types into a password box." }, uuidv7());
    expect(refused?.move).toMatchObject({ status: "refused", detail: "VENOM never types into a password box." });
    expect((await goals.hold(here.account_id, task.id, uuidv7()))?.status).toBe("awaiting_confirmation");
    expect((await goals.carryOn(here.account_id, task.id, uuidv7()))?.status).toBe("running");
  });

  it("closes a waiting question on stop and refuses step controls", async () => {
    const here = await device();
    const task = await goals.begin(here, here.id, "Log in to Wikipedia", uuidv7());
    const asked = await goals.propose(here.account_id, task.id, signingIn, uuidv7());
    const { receipt } = await tasks.stop(here, { stop_id: uuidv7(), scope: { kind: "task", task_id: task.id } }, uuidv7());
    expect(receipt.tasks[0]).toMatchObject({ kind: "goal", status: "stopped", result: "Stopped after 0 moves." });
    expect((await goals.move(here.account_id, asked?.move.id ?? ""))?.status).toBe("stopped");
    await expect(tasks.control(here, task.id, { kind: "resume" }, uuidv7())).rejects.toMatchObject({ statusCode: 409 });
  });

  it("lists the latest moves of a goal in order, only for its own account", async () => {
    const here = await device();
    const stranger = await device();
    const task = await goals.begin(here, here.id, "Open Notepad and write a list", uuidv7());
    expect(await goals.list(here.account_id, task.id)).toEqual([]);
    for (let made = 0; made < 42; made += 1) {
      const proposed = await goals.propose(here.account_id, task.id, { ...typing, intent: `Move ${made + 1}` }, uuidv7());
      await goals.finish(here.account_id, proposed?.move.id ?? "", "done", "Did type.", uuidv7());
    }
    const listed = await goals.list(here.account_id, task.id);
    expect(listed?.map((move) => move.number)).toEqual(Array.from({ length: 40 }, (_, at) => at + 3));
    expect(listed?.at(-1)).toMatchObject({ intent: "Move 42", status: "done", detail: "Did type." });
    expect(await goals.list(stranger.account_id, task.id)).toBeNull();
  });

  it("fails open goals and their moves when VENOM restarts", async () => {
    const here = await device();
    const task = await goals.begin(here, here.id, "Open Notepad", uuidv7());
    const running = await goals.propose(here.account_id, task.id, typing, uuidv7());
    await tasks.interruptAll();
    expect(await goals.state(here.account_id, task.id)).toMatchObject({ status: "failed", result: "VENOM restarted before this goal was reached." });
    expect((await goals.move(here.account_id, running?.move.id ?? ""))?.status).toBe("failed");
  });
});
