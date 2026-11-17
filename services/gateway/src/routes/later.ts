import { Id, LaterList } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { notFound } from "../errors.ts";

const LaterParams = z.strictObject({ item_id: Id });

const gone = "That item is no longer kept for later.";

export function laterRoutes(app: FastifyInstance, { store, broadcastLaterSeen, broadcastLaterRemoved }: GatewayContext): void {
  app.get("/v1/later", async (request) => {
    return LaterList.parse({ items: await store.laterItems(requireSignedIn(request).account_id) });
  });

  app.post("/v1/later/:item_id/seen", async (request) => {
    const device = requireSignedIn(request);
    const { item_id } = LaterParams.parse(request.params);
    const item = await store.markLaterSeen({ device, requestId: request.id, itemId: item_id });
    if (item === null) {
      throw notFound(gone);
    }
    broadcastLaterSeen(device.account_id, request.id, item);
    return item;
  });

  app.delete("/v1/later/:item_id", async (request, reply) => {
    const device = requireSignedIn(request);
    const { item_id } = LaterParams.parse(request.params);
    if (!(await store.removeLater({ device, requestId: request.id, itemId: item_id }))) {
      throw notFound(gone);
    }
    broadcastLaterRemoved(device.account_id, request.id, item_id);
    return reply.code(204).send();
  });
}
