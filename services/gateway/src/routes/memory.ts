import { Id, MemoryDraft } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";

const MemoryParams = z.strictObject({ memory_id: Id });

export function memoryRoutes(app: FastifyInstance, { memory, broadcastMemory, broadcastForgotten }: GatewayContext): void {
  app.get("/v1/memory", async (request) => {
    return memory.list(requireSignedIn(request).account_id);
  });

  app.post("/v1/memory", async (request, reply) => {
    const device = requireSignedIn(request);
    const draft = MemoryDraft.parse(request.body);
    const { item } = await memory.save(device, request.id, draft, { kind: "settings" });
    broadcastMemory(device.account_id, request.id, item);
    return reply.code(201).send(item);
  });

  app.put("/v1/memory/:memory_id", async (request) => {
    const device = requireSignedIn(request);
    const { memory_id } = MemoryParams.parse(request.params);
    const item = await memory.edit(device, request.id, memory_id, MemoryDraft.parse(request.body));
    broadcastMemory(device.account_id, request.id, item);
    return item;
  });

  app.delete("/v1/memory/:memory_id", async (request) => {
    const device = requireSignedIn(request);
    const { memory_id } = MemoryParams.parse(request.params);
    const forgotten = await memory.forget(device, request.id, memory_id);
    broadcastForgotten(device.account_id, request.id, forgotten);
    return forgotten;
  });
}
