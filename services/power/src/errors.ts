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
      `Ooh, I have used all ${allowance} of today's free answers with ${engine.name}, buddy. They come back at midnight UTC, or choose a Swift or Titan engine in Models and I will carry on with your power.`,
    ),
  noPower: (engine: EngineSpec) =>
    new PowerError(
      402,
      "out_of_power",
      `Ooh, I am out of power for ${engine.name}, buddy. Choose a free engine such as Dove in Models, or add power to keep using ${engine.name}.`,
    ),
  engineResting: (engine: EngineSpec) =>
    new PowerError(409, "conflict", `Ooh, ${engine.name} is not available right now, buddy. Choose another engine in Models.`),
  unknownEmail: () => new PowerError(404, "not_found", "There is no VENOM account with that email."),
} as const;
