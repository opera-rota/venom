import { ChooseEngine } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";

export function powerRoutes(app: FastifyInstance, { power, availableEngines, broadcastPower }: GatewayContext): void {
  app.get("/v1/power", async (request) => {
    return power.status(requireSignedIn(request).account_id);
  });

  app.get("/v1/engines", async (request) => {
    const device = requireSignedIn(request);
    return power.engines(device.account_id, await availableEngines());
  });

  app.put("/v1/engines/current", async (request) => {
    const device = requireSignedIn(request);
    const { engine } = ChooseEngine.parse(request.body);
    const status = await power.choose(device, request.id, engine, await availableEngines());
    broadcastPower(device.account_id, request.id, status);
    return status;
  });
}
