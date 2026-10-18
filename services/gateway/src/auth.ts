import type { DeviceRef } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { FastifyRequest } from "fastify";
import { unauthorized } from "./errors.ts";

declare module "fastify" {
  interface FastifyRequest {
    device: DeviceRef | null;
  }
}

const bearer = /^Bearer\s+(\S+)$/i;

export function identify(identity: Identity) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = bearer.exec(request.headers.authorization ?? "")?.[1];
    request.device = token === undefined ? null : await identity.authenticate(token);
  };
}

export function requireSignedIn(request: FastifyRequest): DeviceRef {
  if (request.device === null) {
    throw unauthorized();
  }
  return request.device;
}
