import { DeviceKey, SafetySettings, StopRequest } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";

export function safetyRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { tasks, trust, acting } = context;

  app.post("/v1/devices/current/key", async (request) => {
    const device = requireSignedIn(request);
    const { public_key } = DeviceKey.parse(request.body);
    return trust.enroll(device, public_key, request.id);
  });

  app.post("/v1/live/challenge", async (request, reply) => {
    const device = requireSignedIn(request);
    return reply.code(201).send(await trust.challenge(device));
  });

  app.post("/v1/stop", async (request) => {
    const device = requireSignedIn(request);
    const stop = StopRequest.parse(request.body);
    const receipt = await acting.halt(device, stop, request.id);
    request.log.info({ stop_id: stop.stop_id, tasks: receipt.tasks.length }, "stop delivered");
    return receipt;
  });

  app.get("/v1/settings/safety", async (request) => {
    const device = requireSignedIn(request);
    return SafetySettings.parse(await tasks.settings(device.account_id));
  });

  app.put("/v1/settings/safety", async (request) => {
    const device = requireSignedIn(request);
    return SafetySettings.parse(await tasks.saveSettings(device, SafetySettings.parse(request.body), request.id));
  });
}
