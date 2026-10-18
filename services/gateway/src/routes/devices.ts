import { CapabilityReport, DeviceList, Id } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import { closeCodes, type GatewayContext } from "../context.ts";
import { forbidden } from "../errors.ts";

const DeviceParams = z.strictObject({ device_id: Id });

export function deviceRoutes(app: FastifyInstance, { identity, hub, broadcastDevices }: GatewayContext): void {
  app.get("/v1/session", async (request) => {
    return identity.session(requireSignedIn(request));
  });

  app.get("/v1/devices", async (request) => {
    const device = requireSignedIn(request);
    return DeviceList.parse({ current_device_id: device.id, devices: await identity.devices(device.account_id) });
  });

  app.put("/v1/devices/current/capabilities", async (request) => {
    const device = requireSignedIn(request);
    const report = CapabilityReport.parse(request.body);
    if (report.device_id !== device.id) {
      throw forbidden();
    }
    const updated = await identity.reportCapabilities(device, report.capabilities, request.id);
    await broadcastDevices(device.account_id, request.id);
    return updated;
  });

  app.delete("/v1/devices/:device_id", async (request) => {
    const device = requireSignedIn(request);
    const { device_id } = DeviceParams.parse(request.params);
    const revoked = await identity.revokeDevice(device, device_id, request.id);
    hub.disconnectDevice(revoked.id, closeCodes.revoked, "device removed");
    await broadcastDevices(device.account_id, request.id);
    return revoked;
  });
}
