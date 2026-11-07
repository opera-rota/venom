import { randomUUID } from "node:crypto";
import type { CommandFrame, CommandReport, DeviceAction, StepOutputChunk } from "@venom/contracts";
import { commandText, newKeyPair, signText, unconfirmedScriptWords } from "@venom/safety/device";
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
  reported(count: number): Promise<CommandReport[]>;
}

type Answer = (request: HandRequest, options: SendOptions) => Promise<HandResult>;

const ok = (detail: string, data: Record<string, unknown> = {}): HandResult => ({ ok: true, stopped: false, detail, data });

function bench(answer: Answer | null): Bench {
  const calls: Call[] = [];
  const reports: CommandReport[] = [];
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
      for (const wake of [...waiters]) wake();
    },
    output: async (chunk) => {
      chunks.push(chunk);
    },
    refused: (reason) => refusals.push(reason),
    worker,
    flushMs: 5,
  });
  return {
    hands,
    calls,
    reports,
    chunks,
    refusals,
    reported: (count) =>
      new Promise((resolve) => {
        const check = () => {
          if (reports.length >= count) {
            waiters.delete(check);
            resolve(reports.slice(0, count));
          }
        };
        waiters.add(check);
        check();
      }),
  };
}

function frame(taskId: string, action: DeviceAction, confirmed = false): { readonly frame: CommandFrame; readonly commandId: string } {
  const commandId = randomUUID();
  const now = Date.now();
  const payload = JSON.stringify({
    command_id: commandId,
    account_id: accountId,
    device_id: deviceId,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 30_000).toISOString(),
    body: { kind: "run_step", task_id: taskId, step_id: randomUUID(), action, confirmed },
  });
  return { commandId, frame: { type: "command", command: { payload, signature: signText(server, commandText(payload)) } } };
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
