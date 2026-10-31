import type { CommandOutcome, CommandReport, ConfirmationAnswered, ConfirmRequest, DeviceAction, Task } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { CommandSigner, NextStep, Tasks } from "@venom/safety";
import type { FastifyBaseLogger } from "fastify";
import type { LiveHub } from "./live-hub.ts";

export interface Outcome {
  readonly outcome: CommandOutcome;
  readonly detail: string;
}

export interface RunnerOptions {
  readonly tasks: Tasks;
  readonly signer: CommandSigner;
  readonly hub: LiveHub;
  readonly log: FastifyBaseLogger;
  readonly closing: AbortSignal;
  readonly graceMs?: number;
  track(work: Promise<unknown>): void;
  publishTask(accountId: string, requestId: string, task: Task): void;
  publishConfirmation(accountId: string, requestId: string, request: ConfirmRequest, answered: ConfirmationAnswered | null): void;
}

interface Awaiting {
  readonly deviceId: string;
  readonly targetName: string;
  settle(outcome: Outcome): void;
}

function durationMs(action: DeviceAction): number {
  switch (action.name) {
    case "wait":
      return action.seconds * 1000;
  }
}

export class TaskRunner {
  readonly #options: RunnerOptions;
  readonly #graceMs: number;
  readonly #reports = new Map<string, Awaiting>();
  readonly #answers = new Map<string, () => void>();

  constructor(options: RunnerOptions) {
    this.#options = options;
    this.#graceMs = options.graceMs ?? 15_000;
    options.closing.addEventListener("abort", () => this.#shutdown(), { once: true });
  }

  run(accountId: string, taskId: string, requestId: string): void {
    const work = this.#drive(accountId, taskId, requestId).catch((error: unknown) => {
      this.#options.log.error({ err: error, task_id: taskId }, "task runner failed");
    });
    this.#options.track(work);
  }

  report(device: DeviceRef, report: CommandReport): boolean {
    const awaiting = this.#reports.get(report.command_id);
    if (awaiting === undefined || awaiting.deviceId !== device.id) {
      return false;
    }
    awaiting.settle({ outcome: report.outcome, detail: report.detail ?? this.#defaultDetail(report.outcome) });
    return true;
  }

  answered(stepId: string): void {
    this.#answers.get(stepId)?.();
  }

  wakeAll(): void {
    for (const wake of [...this.#answers.values()]) {
      wake();
    }
  }

  deviceLost(deviceId: string): void {
    for (const awaiting of [...this.#reports.values()]) {
      if (awaiting.deviceId === deviceId) {
        awaiting.settle({ outcome: "failed", detail: `${awaiting.targetName} went offline before this step finished.` });
      }
    }
  }

  async #drive(accountId: string, taskId: string, requestId: string): Promise<void> {
    const { tasks, closing } = this.#options;
    while (!closing.aborted) {
      const next = await tasks.next(accountId, taskId);
      if (next.kind === "over") {
        return;
      }
      if (next.kind === "finished") {
        this.#publish(accountId, requestId, await tasks.complete(accountId, taskId, requestId));
        return;
      }
      const { step } = next;
      if (step.requiresConfirmation && !step.approved) {
        await this.#confirm(accountId, taskId, step, requestId);
        continue;
      }
      const started = await tasks.start(accountId, step.id, requestId);
      if (started === null) {
        continue;
      }
      this.#publish(accountId, requestId, started);
      const { outcome, detail } = await this.#deliver(accountId, taskId, step);
      this.#publish(accountId, requestId, await tasks.finish(accountId, step.id, outcome, detail, requestId));
      if (outcome !== "done") {
        return;
      }
    }
  }

  async #confirm(accountId: string, taskId: string, step: NextStep, requestId: string): Promise<void> {
    const { tasks } = this.#options;
    const woken = new Promise<void>((resolve) => this.#answers.set(step.id, resolve));
    try {
      if (!step.waiting) {
        const asked = await tasks.ask(accountId, step.id, requestId);
        if (asked !== null) {
          this.#publish(accountId, requestId, asked.task);
          this.#options.publishConfirmation(accountId, requestId, asked.request, null);
        }
      }
      const now = await tasks.next(accountId, taskId);
      if (now.kind === "step" && now.step.id === step.id && now.step.waiting && !this.#options.closing.aborted) {
        await woken;
      }
    } finally {
      this.#answers.delete(step.id);
    }
  }

  async #deliver(accountId: string, taskId: string, step: NextStep): Promise<Outcome> {
    const { signer, hub } = this.#options;
    if (!hub.canAct(step.targetDeviceId)) {
      return { outcome: "failed", detail: `${step.targetName} is not connected, so this step could not run.` };
    }
    const { commandId, frame } = signer.issue(
      { id: step.targetDeviceId, account_id: accountId },
      { kind: "run_step", task_id: taskId, step_id: step.id, action: step.action },
    );
    return new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => settle({ outcome: "failed", detail: `${step.targetName} did not report back in time.` }), durationMs(step.action) + this.#graceMs);
      const settle = (outcome: Outcome) => {
        clearTimeout(timer);
        this.#reports.delete(commandId);
        resolve(outcome);
      };
      this.#reports.set(commandId, { deviceId: step.targetDeviceId, targetName: step.targetName, settle });
      if (hub.sendCommand(step.targetDeviceId, frame) === 0) {
        settle({ outcome: "failed", detail: `${step.targetName} is not connected, so this step could not run.` });
      }
    });
  }

  #publish(accountId: string, requestId: string, task: Task | null): void {
    if (task !== null) {
      this.#options.publishTask(accountId, requestId, task);
    }
  }

  #defaultDetail(outcome: CommandOutcome): string {
    switch (outcome) {
      case "done":
        return "Finished.";
      case "stopped":
        return "Stopped before it finished.";
      case "failed":
        return "The device could not finish this step.";
      case "refused":
        return "The device refused this command.";
    }
  }

  #shutdown(): void {
    this.wakeAll();
    for (const awaiting of [...this.#reports.values()]) {
      awaiting.settle({ outcome: "failed", detail: "VENOM's gateway stopped before this step finished." });
    }
  }
}
