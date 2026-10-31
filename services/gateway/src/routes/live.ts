import { ApiError, Id, Signature } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { closeCodes, type GatewayContext } from "../context.ts";

export function liveRoute(app: FastifyInstance, context: GatewayContext): void {
  const { hub, identity, trust, runner, heartbeatMs, track, isClosing, broadcastDevices } = context;
  const queue = new Map<string, Promise<void>>();
  const proven = new WeakSet<FastifyRequest>();

  async function prove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const device = request.device;
    if (device === null || !(await trust.hasKey(device))) {
      return;
    }
    const challengeId = Id.safeParse(request.headers["x-venom-challenge"]);
    const signature = Signature.safeParse(request.headers["x-venom-signature"]);
    if (challengeId.success && signature.success && (await trust.prove(device, challengeId.data, signature.data))) {
      proven.add(request);
      return;
    }
    await reply.code(403).send(ApiError.parse({ error: "forbidden", message: "This device must sign a fresh challenge to open its live link." }));
  }

  function presence(device: DeviceRef, online: boolean, log: FastifyBaseLogger): void {
    const previous = queue.get(device.id) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (isClosing()) {
        return;
      }
      await identity.markPresence(device, online);
      await broadcastDevices(device.account_id, uuidv7());
    });
    const settled = next.catch((error: unknown) => log.error({ err: error, device_id: device.id }, "presence update failed"));
    queue.set(device.id, settled);
    track(settled);
    void settled.finally(() => {
      if (queue.get(device.id) === settled) {
        queue.delete(device.id);
      }
    });
  }

  app.get("/v1/live", { websocket: true, preValidation: prove }, (socket, request) => {
    const device = request.device;
    if (device === null) {
      socket.close(closeCodes.unauthorized, "not signed in");
      return;
    }
    if (isClosing()) {
      socket.close(1012, "gateway restarting");
      return;
    }

    const attachment = hub.attach({
      deviceId: device.id,
      accountId: device.account_id,
      signed: proven.has(request),
      send: (frame) => socket.send(JSON.stringify(frame)),
      close: (code, reason) => socket.close(code, reason),
    });
    if (attachment.first) {
      presence(device, true, request.log);
    }

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, heartbeatMs);

    socket.on("pong", () => {
      alive = true;
    });
    socket.on("close", () => {
      clearInterval(heartbeat);
      if (attachment.detach().last) {
        runner.deviceLost(device.id);
        presence(device, false, request.log);
      }
    });
  });
}
