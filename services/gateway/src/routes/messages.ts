import { MessageHistory, RetryAnswer, SendMessage, SendMessageAccepted } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { converse, type Question } from "../conversation.ts";
import { conflict, notFound } from "../errors.ts";
import { RequestTrace } from "../live-hub.ts";

const HistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function messageRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { store, hub, brain, stopping, track } = context;
  const answering = new Set<string>();

  function start(device: DeviceRef, requestId: string, question: Question, log: FastifyBaseLogger, key: string): string {
    const trace = new RequestTrace(hub, device.id, requestId);
    trace.state("accepted");
    answering.add(key);
    track(
      converse({ store, brain, trace, device, signal: stopping, log }, question).finally(() => {
        answering.delete(key);
      }),
    );
    return trace.requestId;
  }

  app.get("/v1/messages", async (request) => {
    const device = requireSignedIn(request);
    const { limit } = HistoryQuery.parse(request.query);
    return MessageHistory.parse({ messages: await store.listMessages(device.account_id, limit) });
  });

  app.post("/v1/messages", async (request, reply) => {
    const device = requireSignedIn(request);
    const { text } = SendMessage.parse(request.body);
    const requestId = start(device, request.id, { kind: "new", text }, request.log, request.id);
    return reply.code(202).send(SendMessageAccepted.parse({ request_id: requestId }));
  });

  app.post("/v1/messages/retry", async (request, reply) => {
    const device = requireSignedIn(request);
    const { request_id } = RetryAnswer.parse(request.body);
    const asked = await store.findRequest(device.account_id, request_id);
    if (asked === null) {
      throw notFound("There is no message to answer again.");
    }
    if (asked.answered) {
      throw conflict("VENOM already answered this message.");
    }
    if (answering.has(request_id)) {
      throw conflict("VENOM is still answering this message.");
    }
    const requestId = start(device, request.id, { kind: "retry", message: asked.question, requestId: request_id }, request.log, request_id);
    return reply.code(202).send(SendMessageAccepted.parse({ request_id: requestId }));
  });
}
