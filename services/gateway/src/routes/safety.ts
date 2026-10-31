import { DeviceKey, SafetySettings, StopRequest } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";

export function safetyRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { hub, signer, tasks, trust, runner, broadcastTask, broadcastConfirmation, broadcastHalt } = context;

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
    const { scope } = stop;
    const reached = hub.devicesOf(device.account_id).filter((deviceId) => scope.kind !== "device" || deviceId === scope.device_id);
    const taskId = scope.kind === "task" ? scope.task_id : null;
    for (const deviceId of reached) {
      hub.sendCommand(deviceId, signer.issue({ id: deviceId, account_id: device.account_id }, { kind: "stop", stop_id: stop.stop_id, task_id: taskId }).frame);
    }
    const { receipt, closed } = await tasks.stop(device, stop, request.id);
    runner.wakeAll();
    broadcastHalt(device.account_id, request.id, receipt);
    for (const task of receipt.tasks) {
      broadcastTask(device.account_id, request.id, task);
    }
    for (const confirmation of closed) {
      broadcastConfirmation(device.account_id, request.id, confirmation, {
        outcome: "stopped",
        device_id: device.id,
        device_name: null,
        answered_at: receipt.stopped_at,
      });
    }
    request.log.info({ stop_id: stop.stop_id, tasks: receipt.tasks.length }, "stop delivered");
    return receipt;
  });

  app.get("/v1/settings/safety", async (request) => {
    const device = requireSignedIn(request);
    return SafetySettings.parse({ confirmation_strictness: await tasks.strictness(device.account_id) });
  });

  app.put("/v1/settings/safety", async (request) => {
    const device = requireSignedIn(request);
    const { confirmation_strictness } = SafetySettings.parse(request.body);
    return SafetySettings.parse({ confirmation_strictness: await tasks.setStrictness(device, confirmation_strictness, request.id) });
  });
}
