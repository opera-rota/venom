import { safetyLimits, type CommandFrame, type CommandReport, type DeviceAction, type RunStepCommand, type StepOutputChunk } from "@venom/contracts";
import { CommandGuard, refusalWords, refusesUnconfirmed, unconfirmedScriptWords } from "@venom/safety/device";
import type { HandRequest, HandResult, SendOptions } from "./hand-helper.ts";
import type { DeviceTrust } from "./session-manager.ts";

export interface HandWorker {
  send(request: HandRequest, options?: SendOptions): Promise<HandResult>;
}

export interface HandsOptions {
  readonly trust: () => DeviceTrust | null;
  readonly report: (report: CommandReport) => Promise<unknown>;
  readonly output?: (chunk: StepOutputChunk) => Promise<unknown>;
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

export const scriptSeconds = 300;

const detailLimit = 300;
const rememberedTasks = 50;
const noHands = "This computer has no working hands right now, so this step could not run.";
const noWindow = "I do not know which window to click in, because no earlier step of this task opened or used one. Nothing was clicked.";

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
    if (typeof window !== "number") {
      return;
    }
    this.#windows.delete(taskId);
    this.#windows.set(taskId, window);
    if (this.#windows.size > rememberedTasks) {
      const [oldest] = this.#windows.keys();
      if (oldest !== undefined) {
        this.#windows.delete(oldest);
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
