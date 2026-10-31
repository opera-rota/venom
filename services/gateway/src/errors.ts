import { ApiError, type ApiErrorCode } from "@venom/contracts";
import { IdentityError } from "@venom/identity";
import { MemoryError } from "@venom/memory";
import { PowerError } from "@venom/power";
import { SafetyError } from "@venom/safety";
import { TaskError } from "@venom/tasks";
import type { FastifyError, FastifyInstance } from "fastify";
import { z } from "zod";

export class GatewayError extends Error {
  override readonly name = "GatewayError";
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const unauthorized = () => new GatewayError(401, "unauthorized", "This device is not signed in to VENOM.");

export const forbidden = () => new GatewayError(403, "forbidden", "A device can only report its own capabilities.");

export const notFound = (message: string) => new GatewayError(404, "not_found", message);

export const conflict = (message: string) => new GatewayError(409, "conflict", message);

export const unsaved = () => new GatewayError(500, "internal", "VENOM could not save this message. Try sending it again.");

export function installErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send(ApiError.parse({ error: "not_found", message: "There is nothing at this address." }));
  });

  app.setErrorHandler<FastifyError | z.ZodError | GatewayError | IdentityError | PowerError | MemoryError | SafetyError | TaskError>((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send(
        ApiError.parse({
          error: "invalid_request",
          message: "Some of the details sent were not valid.",
          issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
        }),
      );
    }
    if (error instanceof GatewayError || error instanceof IdentityError || error instanceof PowerError || error instanceof MemoryError || error instanceof SafetyError || error instanceof TaskError) {
      return reply.code(error.statusCode).send(ApiError.parse({ error: error.code, message: error.message }));
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
      return reply.code(statusCode).send(ApiError.parse({ error: "invalid_request", message: error.message }));
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send(ApiError.parse({ error: "internal", message: "VENOM hit an unexpected problem." }));
  });
}
