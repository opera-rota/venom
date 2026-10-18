import type { DeviceRef } from "@venom/db";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { closeCodes, type GatewayContext } from "../context.ts";

export function liveRoute(app: FastifyInstance, context: GatewayContext): void {
  const { hub, identity, heartbeatMs, track, isClosing, broadcastDevices } = context;
  const queue = new Map<string, Promise<void>>();

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

  app.get("/v1/live", { websocket: true }, (socket, request) => {
    const device = request.device;
    if (device === null) {
      socket.close(closeCodes.unauthorized, "not signed in");
      return;
    }

    const attachment = hub.attach({
      deviceId: device.id,
      accountId: device.account_id,
      send: (event) => socket.send(JSON.stringify(event)),
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
        presence(device, false, request.log);
      }
    });
  });
}
