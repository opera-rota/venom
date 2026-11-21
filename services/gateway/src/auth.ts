import { liveProtocols } from "@venom/contracts";
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

export function offered(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers["sec-websocket-protocol"];
  if (typeof header !== "string") {
    return undefined;
  }
  const prefix = `${name}.`;
  return header
    .split(",")
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol.startsWith(prefix))
    ?.slice(prefix.length);
}

export function identify(identity: Identity) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = bearer.exec(request.headers.authorization ?? "")?.[1] ?? offered(request, liveProtocols.bearer);
    request.device = token === undefined ? null : await identity.authenticate(token);
  };
}

export function requireSignedIn(request: FastifyRequest): DeviceRef {
  if (request.device === null) {
    throw unauthorized();
  }
  return request.device;
}
