import { MessageHistory, SendMessage, SendMessageAccepted } from "@venom/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { echoMessage } from "../echo.ts";
import { RequestTrace } from "../live-hub.ts";

const HistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function messageRoutes(app: FastifyInstance, { store, hub, track }: GatewayContext): void {
  app.get("/v1/messages", async (request) => {
    const device = requireSignedIn(request);
    const { limit } = HistoryQuery.parse(request.query);
    return MessageHistory.parse({ messages: await store.listMessages(device.account_id, limit) });
  });

  app.post("/v1/messages", async (request, reply) => {
    const device = requireSignedIn(request);
    const { text } = SendMessage.parse(request.body);
    const trace = new RequestTrace(hub, device.id, request.id);

    trace.state("accepted");
    track(
      echoMessage(store, trace, device, text).catch((error: unknown) => {
        request.log.error({ err: error }, "message pipeline failed");
      }),
    );

    return reply.code(202).send(SendMessageAccepted.parse({ request_id: trace.requestId }));
  });
}
