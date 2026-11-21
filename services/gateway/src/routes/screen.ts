import { SendScreenSignal } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { conflict } from "../errors.ts";
import { screenSignalEvent } from "../live-hub.ts";

const signalBodyLimit = 64 * 1024;

export function screenRoutes(app: FastifyInstance, { hub }: GatewayContext): void {
  app.post("/v1/screen/signal", { bodyLimit: signalBodyLimit }, async (request, reply) => {
    const device = requireSignedIn(request);
    const { to_device_id, session_id, signal } = SendScreenSignal.parse(request.body);
    if (to_device_id === device.id || !hub.devicesOf(device.account_id).includes(to_device_id)) {
      throw conflict("That device is not connected to VENOM right now.");
    }
    hub.publishToDevice(to_device_id, screenSignalEvent(request.id, device.id, session_id, signal));
    return reply.code(204).send();
  });
}
