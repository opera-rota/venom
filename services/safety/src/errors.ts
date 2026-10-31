import type { ApiErrorCode } from "@venom/contracts";

export class SafetyError extends Error {
  override readonly name = "SafetyError";
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const refuseSafety = {
  keyMissing: () =>
    new SafetyError(409, "device_key_missing", "This device has no device key yet, so it cannot take actions. Restart VENOM on it and try again."),
  keyTaken: () =>
    new SafetyError(409, "conflict", "This device already has a different key. Attach it again to give it a new one."),
  alreadyAnswered: (by: string | null) =>
    new SafetyError(409, "already_answered", by === null ? "This was already answered." : `This was already answered on ${by}.`),
  noLongerWaiting: () =>
    new SafetyError(409, "already_answered", "This step is no longer waiting for an answer. The task was stopped or has moved on."),
  taskNotFound: () => new SafetyError(404, "not_found", "That task is not part of your VENOM."),
  tooManyTasks: (limit: number) =>
    new SafetyError(409, "conflict", `VENOM is already running ${limit} tasks. Wait for one to finish or press Stop.`),
  deviceOffline: (name: string) =>
    new SafetyError(409, "conflict", `${name} is not connected, so it cannot take actions right now.`),
  stopTaken: () => new SafetyError(409, "conflict", "That stop number was already used. Press Stop again."),
} as const;
