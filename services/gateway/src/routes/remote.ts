import { RemoteSession, SendRemote, type Device } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { FastifyInstance } from "fastify";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { conflict } from "../errors.ts";
import { remoteEvent } from "../live-hub.ts";

export const remoteWords = {
  notReady: "That computer is not ready for Remote right now, buddy. Choose it with Use this device, keep it awake and unlocked, and try again.",
} as const;

export function remoteRoutes(app: FastifyInstance, { identity, hub, goals, loop, signer }: GatewayContext): void {
  async function controlled(device: DeviceRef, deviceId: string): Promise<Device> {
    const target = deviceId === device.id ? undefined : (await identity.devices(device.account_id)).find((candidate) => candidate.id === deviceId);
    if (target === undefined || target.type !== "computer" || !target.in_use || target.locked || !target.capabilities.screen_control || !hub.canAct(target.id)) {
      throw conflict(remoteWords.notReady);
    }
    return target;
  }

  app.post("/v1/remote/session", async (request, reply) => {
    const device = requireSignedIn(request);
    const { device_id, on } = RemoteSession.parse(request.body);
    const target = on ? await controlled(device, device_id) : null;
    if (target !== null) {
      const open = await goals.open(device.account_id);
      if (open !== null && open.task.target_device_id === target.id && open.task.status === "running") {
        loop.interrupted(target.id, open.task.id);
      }
    }
    hub.publishToAccount(device.account_id, remoteEvent(request.id, device.id, device_id, on));
    return reply.code(204).send();
  });

  app.post("/v1/remote/action", async (request, reply) => {
    const device = requireSignedIn(request);
    const { device_id, action } = SendRemote.parse(request.body);
    const target = await controlled(device, device_id);
    const { frame } = signer.issue({ id: target.id, account_id: device.account_id }, { kind: "remote", from_device_id: device.id, action });
    if (hub.sendCommand(target.id, frame) === 0) {
      throw conflict(remoteWords.notReady);
    }
    return reply.code(202).send();
  });
}
