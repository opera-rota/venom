import { randomUUID } from "node:crypto";
import type { CommandBody, CommandFrame, CommandReport, DeviceAction, Observation, ObservationReport, SpotReport, StepOutputChunk } from "@venom/contracts";
import { commandText, newKeyPair, signText, unconfirmedMoveWords, unconfirmedScriptWords } from "@venom/safety/device";
import { describe, expect, it } from "vitest";
import type { HandRequest, HandResult, SendOptions } from "../src/main/hand-helper.ts";
import { Hands, type HandWorker } from "../src/main/hands.ts";

const server = newKeyPair();
const deviceId = randomUUID();
const accountId = randomUUID();

interface Call {
  readonly request: HandRequest;
  readonly timeoutMs: number | undefined;
}

interface Bench {
  readonly hands: Hands;
  readonly calls: Call[];
  readonly reports: CommandReport[];
  readonly chunks: StepOutputChunk[];
  readonly refusals: string[];
  readonly sights: (ObservationReport | SpotReport)[];
  reported(count: number): Promise<CommandReport[]>;
  answered(count: number): Promise<(CommandReport | ObservationReport | SpotReport)[]>;
}

type Answer = (request: HandRequest, options: SendOptions) => Promise<HandResult>;

const ok = (detail: string, data: Record<string, unknown> = {}): HandResult => ({ ok: true, stopped: false, detail, data });

function bench(answer: Answer | null, own: readonly number[] = []): Bench {
  const calls: Call[] = [];
  const reports: CommandReport[] = [];
  const sights: (ObservationReport | SpotReport)[] = [];
  const answers: (CommandReport | ObservationReport | SpotReport)[] = [];
  const chunks: StepOutputChunk[] = [];
  const refusals: string[] = [];
  const waiters = new Set<() => void>();
  const worker: HandWorker | null =
    answer === null
      ? null
      : {
          send: (request, options = {}) => {
            calls.push({ request, timeoutMs: options.timeoutMs });
            return answer(request, options);
          },
        };
  const hands = new Hands({
    trust: () => ({ deviceId, pair: newKeyPair(), serverKey: server.publicKey }),
    report: async (report) => {
      reports.push(report);
      answers.push(report);
      for (const wake of [...waiters]) wake();
    },
    observed: async (report) => {
      sights.push(report);
      answers.push(report);
      for (const wake of [...waiters]) wake();
    },
    spotted: async (report) => {
      sights.push(report);
      answers.push(report);
      for (const wake of [...waiters]) wake();
    },
    ownWindows: () => own,
    output: async (chunk) => {
      chunks.push(chunk);
    },
    refused: (reason) => refusals.push(reason),
    worker,
    flushMs: 5,
  });
  const until = <T>(list: T[], count: number) =>
    new Promise<T[]>((resolve) => {
      const check = () => {
        if (list.length >= count) {
          waiters.delete(check);
          resolve(list.slice(0, count));
        }
      };
      waiters.add(check);
      check();
    });
  return {
    hands,
    calls,
    reports,
    chunks,
    refusals,
    sights,
    reported: (count) => until(reports, count),
    answered: (count) => until(answers, count),
  };
}

function signed(body: CommandBody): { readonly frame: CommandFrame; readonly commandId: string } {
  const commandId = randomUUID();
  const now = Date.now();
  const payload = JSON.stringify({
    command_id: commandId,
    account_id: accountId,
    device_id: deviceId,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 30_000).toISOString(),
    body,
  });
  return { commandId, frame: { type: "command", command: { payload, signature: signText(server, commandText(payload)) } } };
}

function frame(taskId: string, action: DeviceAction, confirmed = false): { readonly frame: CommandFrame; readonly commandId: string } {
  return signed({ kind: "run_step", task_id: taskId, step_id: randomUUID(), action, confirmed });
}

const script: DeviceAction = { name: "run_script", language: "powershell", purpose: "List the work folder", code: "Get-ChildItem" };

describe("the hands on this computer", () => {
  it("refuses a script nobody said yes to, without touching the hands", async () => {
    const { hands, calls, reported, refusals } = bench(async () => ok("ran"));
    const { frame: unconfirmed, commandId } = frame(randomUUID(), script);
    hands.receive(unconfirmed);
    expect(await reported(1)).toEqual([{ command_id: commandId, outcome: "refused", detail: unconfirmedScriptWords, output: null }]);
    expect(calls).toEqual([]);
    expect(refusals).toEqual([unconfirmedScriptWords]);
  });

  it("runs a confirmed script in the task's work folder, streams its output in order and keeps it with the result", async () => {
    const { hands, calls, reported, chunks } = bench(async (_request, { onOutput }) => {
      onOutput?.("first line");
      onOutput?.("second line");
      return ok("The script finished.", { output: "first line\r\nsecond line\r\n", exit_code: 0 });
    });
    const task = randomUUID();
    const { frame: confirmed, commandId } = frame(task, script, true);
    hands.receive(confirmed);
    const [report] = await reported(1);
    expect(calls).toEqual([{ request: { op: "run_script", language: "powershell", code: "Get-ChildItem", task, timeout_seconds: 300 }, timeoutMs: 320_000 }]);
    expect(chunks).toEqual([{ command_id: commandId, sequence: 0, text: "first line\nsecond line\n" }]);
    expect(report).toEqual({ command_id: commandId, outcome: "done", detail: "The script finished.", output: "first line\r\nsecond line" });
  });

  it("remembers the window a task opened, and types and clicks only there", async () => {
    const { hands, calls, reported } = bench(async (request) => (request.op === "open_app" ? ok("Opened Notepad: Untitled - Notepad.", { window: 4242 }) : ok("Done.")));
    const task = randomUUID();
    hands.receive(frame(task, { name: "open_app", app: "Notepad", open: null }).frame);
    await reported(1);
    hands.receive(frame(task, { name: "type_text", text: "Milk", into: "the Notepad window" }).frame);
    await reported(2);
    hands.receive(frame(task, { name: "click", on: "File" }).frame);
    await reported(3);
    hands.receive(frame(randomUUID(), { name: "type_text", text: "Eggs", into: "the Notepad window" }).frame);
    await reported(4);
    expect(calls.map((call) => call.request)).toEqual([
      { op: "open_app", app: "Notepad", open: null, task },
      { op: "type_text", window: 4242, title: null, text: "Milk" },
      { op: "click", window: 4242, title: null, on: "File" },
      { op: "type_text", window: null, title: "the Notepad window", text: "Eggs" },
    ]);
  });

  it("clicks nothing when no step of the task opened a window", async () => {
    const { hands, calls, reported } = bench(async () => ok("Clicked."));
    hands.receive(frame(randomUUID(), { name: "click", on: "Random article" }).frame);
    const [report] = await reported(1);
    expect(report?.outcome).toBe("failed");
    expect(report?.detail).toContain("Nothing was clicked.");
    expect(calls).toEqual([]);
  });

  it("stops a running action at once and reports it as stopped", async () => {
    const { hands, reported } = bench(
      (_request, { signal }) =>
        new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ ok: false, stopped: true, detail: "Stopped.", data: {} }), { once: true })),
    );
    const task = randomUUID();
    hands.receive(frame(task, script, true).frame);
    expect(hands.busy).toBe(true);
    expect(hands.haltTask(task)).toBe(1);
    const [report] = await reported(1);
    expect([report?.outcome, report?.detail, hands.busy]).toEqual(["stopped", "Stopped before it finished.", false]);
  });

  it("keeps the output a script printed before it was stopped", async () => {
    const { hands, reported } = bench(
      (_request, { signal, onOutput }) =>
        new Promise((resolve) => {
          onOutput?.("1");
          onOutput?.("2");
          onOutput?.("3");
          signal?.addEventListener("abort", () => resolve({ ok: false, stopped: true, detail: "Stopped.", data: {} }), { once: true });
        }),
    );
    const task = randomUUID();
    hands.receive(frame(task, script, true).frame);
    hands.haltTask(task);
    const [report] = await reported(1);
    expect([report?.outcome, report?.output]).toEqual(["stopped", "1\n2\n3"]);
  });

  it("says plainly when this computer has no hands, and keeps long answers short", async () => {
    const without = bench(null);
    without.hands.receive(frame(randomUUID(), { name: "take_screenshot" }).frame);
    expect((await without.reported(1))[0]?.detail).toBe("This computer has no working hands right now, so this step could not run.");

    const wordy = bench(async () => ({ ok: false, stopped: false, detail: "x".repeat(500), data: {} }));
    wordy.hands.receive(frame(randomUUID(), { name: "take_screenshot" }).frame);
    const [report] = await wordy.reported(1);
    expect([report?.outcome, report?.detail?.length]).toEqual(["failed", 300]);
  });
});

const look: Observation = {
  picture: "QUJD",
  width: 1280,
  height: 720,
  window: "Untitled - Notepad",
  app: "Notepad",
  marks: [
    { id: 1, kind: "box", name: "Text editor", editable: true, password: false, box: { x: 10, y: 80, width: 1200, height: 600 } },
    { id: 2, kind: "button", name: "Buy now", editable: false, password: false, box: { x: 1100, y: 20, width: 90, height: 30 } },
    { id: 3, kind: "box", name: "Password", editable: true, password: true, box: { x: 400, y: 20, width: 200, height: 30 } },
  ],
  focused: 1,
};

const looked = (window: number, seen: Observation = look) => ok(`Looked at the screen and '${seen.window}', and found ${seen.marks.length} things to use.`, { observation: seen, window });

describe("the hands in VENOM's look, think, act loop", () => {
  it("looks at the task's window and sends back what it saw", async () => {
    const { hands, calls, answered } = bench(async (request) => (request.op === "open_app" ? ok("Opened Notepad.", { window: 4242 }) : looked(4242)));
    const task = randomUUID();
    hands.receive(signed({ kind: "move", task_id: task, move_id: randomUUID(), move: { name: "open", app: "Notepad", open: null }, confirmed: false }).frame);
    await answered(1);
    const { frame: observe, commandId } = signed({ kind: "observe", task_id: task });
    hands.receive(observe);
    const [, sight] = await answered(2);
    expect(sight).toEqual({ command_id: commandId, observation: look });
    expect(calls.map((call) => [call.request, call.timeoutMs])).toEqual([
      [{ op: "open_app", app: "Notepad", open: null, task }, 40_000],
      [{ op: "observe", window: 4242, desktop: false }, 60_000],
    ]);
  });

  it("looks only at the desktop when VENOM's own window is in front", async () => {
    const desktop = { ...look, window: "", app: "", marks: [], focused: null };
    const { hands, calls, answered } = bench(async (request) => (request.op === "front" ? ok("The window in front.", { window: 77 }) : looked(0, desktop)), [77]);
    const task = randomUUID();
    hands.receive(signed({ kind: "observe", task_id: task }).frame);
    await answered(1);
    hands.receive(signed({ kind: "move", task_id: task, move_id: randomUUID(), move: { name: "key", key: "enter" }, confirmed: false }).frame);
    hands.receive(signed({ kind: "observe", task_id: task }).frame);
    await answered(3);
    expect(calls.map((call) => call.request)).toEqual([
      { op: "front" },
      { op: "observe", window: null, desktop: true },
      { op: "move", move: { kind: "key", key: "enter" } },
      { op: "front" },
      { op: "observe", window: null, desktop: true },
    ]);
  });

  it("makes one move on the window it looked at, then wants a fresh look", async () => {
    const { hands, calls, answered } = bench(async (request) => (request.op === "observe" ? looked(4242) : ok("Typed 4 characters into mark 1 'Text editor' and checked that it arrived.", { window: 4242 })));
    const task = randomUUID();
    hands.receive(signed({ kind: "observe", task_id: task }).frame);
    await answered(1);
    const typing = { kind: "move", task_id: task, move_id: randomUUID(), move: { name: "type", text: "Milk", mark: 1, enter: false }, confirmed: false } as const;
    const { frame: first, commandId } = signed(typing);
    hands.receive(first);
    const [, done] = await answered(2);
    expect(done).toEqual({ command_id: commandId, outcome: "done", detail: "Typed 4 characters into mark 1 'Text editor' and checked that it arrived.", output: null });
    hands.receive(signed(typing).frame);
    const [, , again] = await answered(3);
    expect(again).toMatchObject({ outcome: "failed", detail: "VENOM must look at the screen again before this move, so it did nothing." });
    expect(calls.map((call) => [call.request.op, call.timeoutMs])).toEqual([["observe", 60_000], ["move", 25_400]]);
  });

  it("refuses by itself a move that needs a yes, and never types into a password box", async () => {
    const { hands, calls, answered, refusals } = bench(async () => looked(4242));
    const task = randomUUID();
    hands.receive(signed({ kind: "observe", task_id: task }).frame);
    await answered(1);
    hands.receive(signed({ kind: "move", task_id: task, move_id: randomUUID(), move: { name: "click", mark: 2, point: null, double: false }, confirmed: false }).frame);
    hands.receive(signed({ kind: "move", task_id: task, move_id: randomUUID(), move: { name: "type", text: "hunter2", mark: 3, enter: false }, confirmed: true }).frame);
    const [, buy, password] = await answered(3);
    expect(buy).toMatchObject({ outcome: "refused", detail: unconfirmedMoveWords });
    expect(password).toMatchObject({ outcome: "refused", detail: expect.stringContaining("password box") });
    expect(refusals).toEqual([unconfirmedMoveWords, expect.stringContaining("password box")]);
    expect(calls.map((call) => call.request.op)).toEqual(["observe"]);
  });

  it("reads a spot and judges a click there by what it read", async () => {
    const { hands, calls, answered } = bench(async (request) =>
      request.op === "observe" ? looked(4242) : request.op === "spot" ? ok("At that spot: link 'Log in'.", { kind: "link", name: "Log in", password: false }) : ok("Clicked."),
    );
    const task = randomUUID();
    hands.receive(signed({ kind: "observe", task_id: task }).frame);
    await answered(1);
    const { frame: spot, commandId } = signed({ kind: "spot", task_id: task, point: { x: 900, y: 40 } });
    hands.receive(spot);
    const [, read] = await answered(2);
    expect(read).toEqual({ command_id: commandId, spot: { kind: "link", name: "Log in", password: false } });
    hands.receive(signed({ kind: "move", task_id: task, move_id: randomUUID(), move: { name: "click", mark: null, point: { x: 900, y: 40 }, double: false }, confirmed: false }).frame);
    const [, , refused] = await answered(3);
    expect(refused).toMatchObject({ outcome: "refused", detail: unconfirmedMoveWords });
    hands.receive(signed({ kind: "move", task_id: task, move_id: randomUUID(), move: { name: "click", mark: null, point: { x: 900, y: 40 }, double: false }, confirmed: true }).frame);
    const [, , , clicked] = await answered(4);
    expect(clicked).toMatchObject({ outcome: "done", detail: "Clicked." });
    expect(calls.map((call) => call.request)).toEqual([
      { op: "observe", window: null, desktop: false },
      { op: "spot", x: 900, y: 40 },
      { op: "move", move: { kind: "click", mark: null, point: { x: 900, y: 40 }, double: false } },
    ]);
  });

  it("waits a pause without the hands, and a stop ends it at once", async () => {
    const { hands, calls, answered } = bench(async () => ok("unused"));
    const task = randomUUID();
    hands.receive(signed({ kind: "move", task_id: task, move_id: randomUUID(), move: { name: "pause", seconds: 5 }, confirmed: false }).frame);
    expect(hands.busy).toBe(true);
    expect(hands.haltTask(task)).toBe(1);
    const [stopped] = await answered(1);
    expect(stopped).toMatchObject({ outcome: "stopped", detail: "Stopped after 0 of 5 seconds." });
    expect([calls.length, hands.busy]).toEqual([0, false]);
  });

  it("says so when a look cannot be read", async () => {
    const { hands, answered } = bench(async () => ok("Looked.", { observation: { picture: "not base64!" }, window: 4242 }));
    hands.receive(signed({ kind: "observe", task_id: randomUUID() }).frame);
    const [report] = await answered(1);
    expect(report).toMatchObject({ outcome: "failed", detail: "The hands sent back a look VENOM could not read." });
  });
});
