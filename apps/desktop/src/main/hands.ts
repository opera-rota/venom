import type { CommandFrame, CommandReport, RunStepCommand } from "@venom/contracts";
import { CommandGuard, refusalWords } from "@venom/safety/device";
import type { DeviceTrust } from "./session-manager.ts";

export interface HandsOptions {
  readonly trust: () => DeviceTrust | null;
  readonly report: (report: CommandReport) => Promise<unknown>;
  readonly refused?: (reason: string) => void;
}

interface Running {
  readonly commandId: string;
  readonly taskId: string;
  readonly abort: AbortController;
}

export class Hands {
  readonly #options: HandsOptions;
  readonly #running = new Map<string, Running>();
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
        void this.#options.report({ command_id: checked.commandId, outcome: "refused", detail: refusalWords[checked.refusal] }).catch(() => {});
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
    const { seconds } = command.action;
    const started = Date.now();

    const finish = (report: Omit<CommandReport, "command_id">) => {
      clearTimeout(timer);
      if (this.#running.get(command.step_id)?.commandId !== commandId) {
        return;
      }
      this.#running.delete(command.step_id);
      void this.#options.report({ command_id: commandId, ...report }).catch(() => {});
    };

    const timer = setTimeout(() => finish({ outcome: "done", detail: `Waited ${seconds} seconds.` }), seconds * 1000);
    abort.signal.addEventListener(
      "abort",
      () => finish({ outcome: "stopped", detail: `Stopped after ${Math.floor((Date.now() - started) / 1000)} of ${seconds} seconds.` }),
      { once: true },
    );
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
