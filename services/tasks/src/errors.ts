import type { ApiErrorCode } from "@venom/contracts";

export class TaskError extends Error {
  override readonly name = "TaskError";
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const refuseTasks = {
  taskNotFound: () => new TaskError(404, "not_found", "That task is not part of your VENOM."),
  stepNotFound: () => new TaskError(404, "not_found", "That step is not part of this task."),
  tooManyTasks: (limit: number) =>
    new TaskError(409, "conflict", `VENOM is already running ${limit} tasks. Wait for one to finish or press Stop.`),
  alreadyAnswered: (by: string | null) =>
    new TaskError(409, "already_answered", by === null ? "This was already answered." : `This was already answered on ${by}.`),
  noLongerWaiting: () =>
    new TaskError(409, "already_answered", "This step is no longer waiting for an answer. The task was stopped or has moved on."),
  stopTaken: () => new TaskError(409, "conflict", "That stop number was already used. Press Stop again."),
  finished: () => new TaskError(409, "conflict", "This task is finished, so its steps cannot change any more."),
  alreadyRunning: () => new TaskError(409, "conflict", "This task is already running."),
  stillStopping: () => new TaskError(409, "conflict", "A step of this task is still stopping. Try again in a moment."),
  notRepeatable: (position: number) =>
    new TaskError(409, "conflict", `Step ${position + 1} may have changed something outside, so I will not repeat it. Ignore it to go on without it.`),
  cannotRetry: () => new TaskError(409, "conflict", "Only a failed step can be tried again."),
  cannotSkip: () => new TaskError(409, "conflict", "Only a step that has not started, or a failed step that is safe to repeat, can be skipped."),
  cannotIgnore: () => new TaskError(409, "conflict", "Only a step that has not started, a skipped step or a failed step can be ignored."),
  lastCounted: () => new TaskError(409, "conflict", "At least one step must still count. Stop the task instead."),
  cannotRestore: () => new TaskError(409, "conflict", "Only a skipped or ignored step can be counted again."),
} as const;
