import type { ApiErrorCode, EngineSpec } from "@venom/contracts";

export class PowerError extends Error {
  override readonly name = "PowerError";
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const refusePower = {
  freeUsedUp: (engine: EngineSpec, allowance: number) =>
    new PowerError(
      402,
      "out_of_power",
      `You have used today's ${allowance} free answers with ${engine.name}. They come back at midnight UTC, or choose a Swift or Titan engine if you have power.`,
    ),
  noPower: (engine: EngineSpec) =>
    new PowerError(
      402,
      "out_of_power",
      `You are out of power for ${engine.name}. Choose a free engine such as Dove, or add power to keep using ${engine.name}.`,
    ),
  engineResting: (engine: EngineSpec) =>
    new PowerError(409, "conflict", `${engine.name} is not available right now. Choose another engine.`),
  unknownEmail: () => new PowerError(404, "not_found", "There is no VENOM account with that email."),
} as const;
