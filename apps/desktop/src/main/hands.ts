import {
  Observation,
  safetyLimits,
  ScreenSpot,
  type CommandFrame,
  type CommandReport,
  type DeviceAction,
  type MoveCommand,
  type ObservationReport,
  type ObserveCommand,
  type RunStepCommand,
  type ScreenMove,
  type ScreenPoint,
  type SpotCommand,
  type SpotReport,
  type StepOutputChunk,
} from "@venom/contracts";
import { CommandGuard, refusalWords, refusesMove, refusesUnconfirmed, unconfirmedScriptWords, type Seen } from "@venom/safety/device";
import type { HandMove, HandRequest, HandResult, SendOptions } from "./hand-helper.ts";
import type { DeviceTrust } from "./session-manager.ts";

export interface HandWorker {
  send(request: HandRequest, options?: SendOptions): Promise<HandResult>;
}

export interface HandsOptions {
  readonly trust: () => DeviceTrust | null;
  readonly report: (report: CommandReport) => Promise<unknown>;
  readonly output?: (chunk: StepOutputChunk) => Promise<unknown>;
  readonly observed?: (report: ObservationReport) => Promise<unknown>;
  readonly spotted?: (report: SpotReport) => Promise<unknown>;
  readonly ownWindows?: () => readonly number[];
  readonly refused?: (reason: string) => void;
  readonly worker?: HandWorker | null;
  readonly flushMs?: number;
}

interface Running {
  readonly commandId: string;
  readonly taskId: string;
  readonly abort: AbortController;
}

type Finished = Omit<CommandReport, "command_id">;

type LoopCommand = ObserveCommand | SpotCommand | MoveCommand;

type Sent =
  | { readonly kind: "finished"; readonly finished: Finished }
  | { readonly kind: "observed"; readonly observation: Observation }
  | { readonly kind: "spotted"; readonly spot: ScreenSpot | null };

interface ReadSpot {
  readonly point: ScreenPoint;
  readonly spot: ScreenSpot | null;
}

export const scriptSeconds = 300;

const detailLimit = 300;
const rememberedTasks = 50;
const noHands = "This computer has no working hands right now, so this step could not run.";
const noWindow = "I do not know which window to click in, because no earlier step of this task opened or used one. Nothing was clicked.";
const lookFirst = "VENOM must look at the screen again before this move, so it did nothing.";
const unreadLook = "The hands sent back a look VENOM could not read.";
const cannotSend = "This computer could not send back what it saw.";
const observeMs = 60_000;
const spotMs = 15_000;
const noSeen: Seen = { marks: [], focused: null };

function failure(detail: string): Sent {
  return { kind: "finished", finished: { outcome: "failed", detail, output: null } };
}

function finished(outcome: CommandReport["outcome"], detail: string): Sent {
  return { kind: "finished", finished: { outcome, detail, output: null } };
}

function handMove(move: Exclude<ScreenMove, { name: "open" | "pause" }>): HandMove {
  switch (move.name) {
    case "click":
      return { kind: "click", mark: move.mark, point: move.point, double: move.double };
    case "type":
      return { kind: "type", text: move.text, mark: move.mark, enter: move.enter };
    case "key":
      return { kind: "key", key: move.key };
    case "scroll":
      return { kind: "scroll", direction: move.direction, steps: move.steps, mark: move.mark };
  }
}

function moveTimeMs(move: ScreenMove): number {
  switch (move.name) {
    case "type":
      return 25_000 + move.text.length * 100;
    case "open":
      return 40_000;
    case "pause":
      return move.seconds * 1000;
    case "click":
    case "key":
    case "scroll":
      return 25_000;
  }
}

function pause(seconds: number, signal: AbortSignal): Promise<Sent> {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(finished("done", `Waited ${seconds} seconds.`));
    }, seconds * 1000);
    const stop = () => {
      clearTimeout(timer);
      resolve(finished("stopped", `Stopped after ${Math.floor((Date.now() - started) / 1000)} of ${seconds} seconds.`));
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

function clip(text: string, limit: number): string {
  const clean = text.trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 3)}...`;
}

function lastOf(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function timeLimitMs(action: DeviceAction): number {
  switch (action.name) {
    case "wait":
      return action.seconds * 1000;
    case "open_app":
      return 40_000;
    case "type_text":
      return 25_000 + action.text.length * 100;
    case "click":
    case "take_screenshot":
      return 25_000;
    case "run_script":
      return (scriptSeconds + 20) * 1000;
  }
}

class OutputPump {
  readonly #send: ((chunk: StepOutputChunk) => Promise<unknown>) | undefined;
  readonly #commandId: string;
  readonly #flushMs: number;
  #waiting = "";
  #seen = "";
  #sequence = 0;
  #timer: NodeJS.Timeout | undefined;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(commandId: string, send: ((chunk: StepOutputChunk) => Promise<unknown>) | undefined, flushMs: number) {
    this.#commandId = commandId;
    this.#send = send;
    this.#flushMs = flushMs;
  }

  push(text: string): void {
    if (text.length === 0) {
      return;
    }
    const line = text.endsWith("\n") ? text : `${text}\n`;
    this.#seen = lastOf(this.#seen + line, safetyLimits.stepOutput);
    if (this.#send === undefined) {
      return;
    }
    this.#waiting += line;
    if (this.#waiting.length >= safetyLimits.outputChunk) {
      this.#flush();
    } else {
      this.#timer ??= setTimeout(() => this.#flush(), this.#flushMs);
    }
  }

  seen(): string | null {
    const text = this.#seen.trimEnd();
    return text.length === 0 ? null : text;
  }

  async close(): Promise<void> {
    this.#flush();
    await this.#chain;
  }

  #flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const send = this.#send;
    while (send !== undefined && this.#waiting.length > 0 && this.#sequence < safetyLimits.outputChunks) {
      const text = this.#waiting.slice(0, safetyLimits.outputChunk);
      this.#waiting = this.#waiting.slice(text.length);
      const chunk = { command_id: this.#commandId, sequence: this.#sequence++, text };
      this.#chain = this.#chain.then(() => send(chunk)).catch(() => undefined);
    }
    this.#waiting = "";
  }
}

export class Hands {
  readonly #options: HandsOptions;
  readonly #running = new Map<string, Running>();
  readonly #windows = new Map<string, number>();
  readonly #looks = new Map<string, Seen>();
  readonly #spots = new Map<string, ReadSpot>();
  #looked: string | null = null;
  #guard: { readonly key: string; readonly guard: CommandGuard } | null = null;

  constructor(options: HandsOptions) {
    this.#options = options;
  }

  get busy(): boolean {
    return this.#running.size > 0;
  }

  receive(frame: CommandFrame): void {
    const guard = this.#currentGuard();
    if (guard === null) {
      this.#options.refused?.("This device has no key yet, so it refused a command.");
      return;
    }
    const checked = guard.check(frame.command);
    if (!checked.ok) {
      this.#options.refused?.(refusalWords[checked.refusal]);
      if (checked.commandId !== null) {
        this.#send({ command_id: checked.commandId, outcome: "refused", detail: refusalWords[checked.refusal], output: null });
      }
      return;
    }
    const { command_id, body } = checked.payload;
    if (body.kind === "stop") {
      if (body.task_id === null) {
        this.haltAll();
      } else {
        this.haltTask(body.task_id);
      }
      return;
    }
    if (body.kind !== "run_step") {
      this.#loop(command_id, body);
      return;
    }
    if (refusesUnconfirmed(body)) {
      this.#options.refused?.(unconfirmedScriptWords);
      this.#send({ command_id, outcome: "refused", detail: unconfirmedScriptWords, output: null });
      return;
    }
    this.#run(command_id, body);
  }

  haltAll(): number {
    return this.#halt(() => true);
  }

  haltTask(taskId: string): number {
    return this.#halt((running) => running.taskId === taskId);
  }

  #halt(matches: (running: Running) => boolean): number {
    const running = [...this.#running.values()].filter(matches);
    for (const { abort } of running) {
      abort.abort();
    }
    return running.length;
  }

  #loop(commandId: string, command: LoopCommand): void {
    const abort = new AbortController();
    this.#running.set(commandId, { commandId, taskId: command.task_id, abort });
    const deliver = (sent: Sent) => {
      this.#running.delete(commandId);
      this.#deliver(commandId, sent);
    };
    void this.#loopWork(command, abort.signal).then(deliver, (error: unknown) =>
      deliver(failure(clip(error instanceof Error ? error.message : String(error), detailLimit))),
    );
  }

  async #loopWork(command: LoopCommand, signal: AbortSignal): Promise<Sent> {
    const worker = this.#options.worker;
    if (worker === undefined || worker === null) {
      return failure(noHands);
    }
    switch (command.kind) {
      case "observe":
        return this.#observe(worker, command, signal);
      case "spot":
        return this.#spot(worker, command, signal);
      case "move":
        return this.#move(worker, command, signal);
    }
  }

  async #observe(worker: HandWorker, { task_id: task }: ObserveCommand, signal: AbortSignal): Promise<Sent> {
    const window = this.#windows.get(task) ?? null;
    const desktop = window === null && (await this.#ownWindowInFront(worker, signal));
    const result = await worker.send({ op: "observe", window, desktop }, { signal, timeoutMs: observeMs });
    if (result.stopped) {
      return finished("stopped", "Stopped before it finished.");
    }
    if (!result.ok) {
      return failure(clip(result.detail, detailLimit) || unreadLook);
    }
    const seen = Observation.safeParse(result.data["observation"]);
    if (!seen.success) {
      return failure(unreadLook);
    }
    if (!desktop) {
      this.#remember(task, result);
    }
    this.#looks.delete(task);
    this.#looks.set(task, { marks: seen.data.marks, focused: seen.data.focused });
    this.#forgetOldest(this.#looks);
    this.#spots.delete(task);
    this.#looked = task;
    return { kind: "observed", observation: seen.data };
  }

  async #spot(worker: HandWorker, { task_id: task, point }: SpotCommand, signal: AbortSignal): Promise<Sent> {
    if (this.#looked !== task) {
      return failure(lookFirst);
    }
    const result = await worker.send({ op: "spot", x: point.x, y: point.y }, { signal, timeoutMs: spotMs });
    if (result.stopped) {
      return finished("stopped", "Stopped before it finished.");
    }
    const read = ScreenSpot.safeParse({ kind: result.data["kind"], name: result.data["name"], password: result.data["password"] });
    const spot = result.ok && read.success ? read.data : null;
    this.#spots.set(task, { point, spot });
    return { kind: "spotted", spot };
  }

  async #move(worker: HandWorker, { task_id: task, move, confirmed }: MoveCommand, signal: AbortSignal): Promise<Sent> {
    if (move.name === "pause") {
      return pause(move.seconds, signal);
    }
    const read = this.#spots.get(task);
    const spot = move.name === "click" && move.point !== null && read !== undefined && read.point.x === move.point.x && read.point.y === move.point.y ? read.spot : null;
    const refusal = refusesMove(move, this.#looks.get(task) ?? noSeen, spot, confirmed);
    if (refusal !== null) {
      this.#options.refused?.(refusal);
      return finished("refused", refusal);
    }
    if (move.name !== "open" && this.#looked !== task) {
      return failure(lookFirst);
    }
    this.#looked = null;
    this.#spots.delete(task);
    const request: HandRequest = move.name === "open" ? { op: "open_app", app: move.app, open: move.open, task } : { op: "move", move: handMove(move) };
    const result = await worker.send(request, { signal, timeoutMs: moveTimeMs(move) });
    this.#remember(task, result);
    if (result.stopped) {
      return finished("stopped", "Stopped before it finished.");
    }
    return finished(result.ok ? "done" : "failed", clip(result.detail, detailLimit) || "The hands gave no answer.");
  }

  async #ownWindowInFront(worker: HandWorker, signal: AbortSignal): Promise<boolean> {
    const own = this.#options.ownWindows?.() ?? [];
    if (own.length === 0) {
      return false;
    }
    const front = await worker.send({ op: "front" }, { signal, timeoutMs: spotMs });
    const window = front.data["window"];
    return front.ok && typeof window === "number" && own.includes(window);
  }

  #deliver(commandId: string, sent: Sent): void {
    switch (sent.kind) {
      case "finished":
        this.#send({ command_id: commandId, ...sent.finished });
        return;
      case "observed": {
        const observed = this.#options.observed;
        if (observed === undefined) {
          this.#send({ command_id: commandId, outcome: "failed", detail: cannotSend, output: null });
          return;
        }
        void observed({ command_id: commandId, observation: sent.observation }).catch(() => {});
        return;
      }
      case "spotted": {
        const spotted = this.#options.spotted;
        if (spotted === undefined) {
          this.#send({ command_id: commandId, outcome: "failed", detail: cannotSend, output: null });
          return;
        }
        void spotted({ command_id: commandId, spot: sent.spot }).catch(() => {});
        return;
      }
    }
  }

  #run(commandId: string, command: RunStepCommand): void {
    const abort = new AbortController();
    this.#running.set(command.step_id, { commandId, taskId: command.task_id, abort });
    const finish = (finished: Finished) => {
      if (this.#running.get(command.step_id)?.commandId !== commandId) {
        return;
      }
      this.#running.delete(command.step_id);
      this.#send({ command_id: commandId, ...finished });
    };
    if (command.action.name === "wait") {
      this.#wait(command.action.seconds, abort.signal, finish);
      return;
    }
    void this.#act(commandId, command, abort.signal).then(finish, (error: unknown) =>
      finish({ outcome: "failed", detail: clip(error instanceof Error ? error.message : String(error), detailLimit), output: null }),
    );
  }

  #wait(seconds: number, signal: AbortSignal, finish: (finished: Finished) => void): void {
    const started = Date.now();
    const timer = setTimeout(() => finish({ outcome: "done", detail: `Waited ${seconds} seconds.`, output: null }), seconds * 1000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        finish({ outcome: "stopped", detail: `Stopped after ${Math.floor((Date.now() - started) / 1000)} of ${seconds} seconds.`, output: null });
      },
      { once: true },
    );
  }

  async #act(commandId: string, command: RunStepCommand, signal: AbortSignal): Promise<Finished> {
    const worker = this.#options.worker;
    if (worker === undefined || worker === null) {
      return { outcome: "failed", detail: noHands, output: null };
    }
    if (command.action.name === "click" && !this.#windows.has(command.task_id)) {
      return { outcome: "failed", detail: noWindow, output: null };
    }
    const pump = new OutputPump(commandId, this.#options.output, this.#options.flushMs ?? 200);
    const result = await worker.send(this.#request(command), { signal, onOutput: (text) => pump.push(text), timeoutMs: timeLimitMs(command.action) });
    await pump.close();
    this.#remember(command.task_id, result);
    const output = command.action.name === "run_script" ? (this.#outputOf(result) ?? pump.seen()) : null;
    if (result.stopped) {
      return { outcome: "stopped", detail: "Stopped before it finished.", output };
    }
    return { outcome: result.ok ? "done" : "failed", detail: clip(result.detail, detailLimit) || "The hands gave no answer.", output };
  }

  #request({ task_id: task, action }: RunStepCommand): HandRequest {
    const window = this.#windows.get(task) ?? null;
    switch (action.name) {
      case "open_app":
        return { op: "open_app", app: action.app, open: action.open, task };
      case "type_text":
        return { op: "type_text", window, title: window === null ? action.into : null, text: action.text };
      case "click":
        return { op: "click", window, title: null, on: action.on };
      case "take_screenshot":
        return { op: "screenshot", window, task };
      case "run_script":
        return { op: "run_script", language: action.language, code: action.code, task, timeout_seconds: scriptSeconds };
      case "wait":
        throw new Error("A wait step needs no hands.");
    }
  }

  #remember(taskId: string, result: HandResult): void {
    const window = result.data["window"];
    if (typeof window !== "number" || window <= 0) {
      return;
    }
    this.#windows.delete(taskId);
    this.#windows.set(taskId, window);
    this.#forgetOldest(this.#windows);
  }

  #forgetOldest(remembered: Map<string, unknown>): void {
    if (remembered.size > rememberedTasks) {
      const [oldest] = remembered.keys();
      if (oldest !== undefined) {
        remembered.delete(oldest);
      }
    }
  }

  #outputOf(result: HandResult): string | null {
    const output = result.data["output"];
    if (typeof output !== "string" || output.trim().length === 0) {
      return null;
    }
    return lastOf(output.trimEnd(), safetyLimits.stepOutput);
  }

  #send(report: CommandReport): void {
    void this.#options.report(report).catch(() => {});
  }

  #currentGuard(): CommandGuard | null {
    const trust = this.#options.trust();
    if (trust?.serverKey == null) {
      return null;
    }
    const key = `${trust.deviceId}:${trust.serverKey}`;
    if (this.#guard?.key !== key) {
      this.#guard = { key, guard: new CommandGuard(trust.serverKey, trust.deviceId) };
    }
    return this.#guard.guard;
  }
}
