import { memoryLimits, type ApiErrorCode } from "@venom/contracts";

export class MemoryError extends Error {
  override readonly name = "MemoryError";
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const refuseMemory = {
  full: () =>
    new MemoryError(
      409,
      "memory_full",
      `My memory is full: I keep at most ${memoryLimits.items} things. Forget something in Memory first, then tell me again.`,
    ),
  unknown: () => new MemoryError(404, "not_found", "That memory does not exist any more."),
} as const;
