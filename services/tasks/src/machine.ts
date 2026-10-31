import type { Effect, StepAction, StepStatus, TaskStatus } from "@venom/contracts";
import { assess } from "@venom/safety";

export const stepMoves: Readonly<Record<StepStatus, readonly StepStatus[]>> = {
  pending: ["waiting", "running", "skipped", "ignored"],
  waiting: ["pending", "stopped"],
  running: ["done", "failed", "stopped"],
  failed: ["pending", "skipped", "ignored"],
  stopped: ["pending"],
  skipped: ["pending", "ignored"],
  ignored: ["pending", "failed"],
  done: [],
};

export const taskMoves: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  created: ["planned", "running", "cancelled"],
  planned: ["running", "cancelled"],
  running: ["awaiting_confirmation", "completed", "failed", "stopped", "cancelled"],
  awaiting_confirmation: ["running", "cancelled", "stopped", "failed"],
  stopped: ["running"],
  failed: ["running"],
  cancelled: ["running"],
  completed: [],
};

export const openTaskStatuses: readonly TaskStatus[] = ["running", "awaiting_confirmation"];

export const resumableTaskStatuses: readonly TaskStatus[] = ["stopped", "failed", "cancelled"];

export function canMoveStep(from: StepStatus, to: StepStatus): boolean {
  return from === to || stepMoves[from].includes(to);
}

export function canMoveTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || taskMoves[from].includes(to);
}

export interface RepeatCheck {
  readonly action: StepAction;
  readonly effects: readonly Effect[];
  readonly reversible: boolean;
}

export function repeatable(step: RepeatCheck): boolean {
  return step.reversible && assess(step, "standard").reasons.length === 0;
}
