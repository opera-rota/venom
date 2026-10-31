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
  deviceOffline: (name: string) =>
    new SafetyError(409, "conflict", `${name} is not connected, so it cannot take actions right now.`),
} as const;
