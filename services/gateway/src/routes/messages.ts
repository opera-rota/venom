import { MessageHistory, RetryAnswer, SendMessage, SendMessageAccepted, type EngineId, type MemoryItem, type Message, type PowerStatus } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { converse, type Question } from "../conversation.ts";
import { conflict, notFound, unsaved } from "../errors.ts";
import { RequestTrace } from "../live-hub.ts";

const HistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function messageRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { store, hub, requests, brain, power, memory, stopping, track, availableEngines, broadcastPower, broadcastMemory } = context;
  const answering = new Set<string>();

  async function save(device: DeviceRef, requestId: string, text: string, log: FastifyBaseLogger): Promise<Message> {
    try {
      const message = await store.recordMessage({ device, requestId, speaker: "user", text });
      requests.asked(message);
      return message;
    } catch (error) {
      log.error({ err: error }, "could not record the message");
      throw unsaved();
    }
  }

  function start(device: DeviceRef, traceId: string, question: Question, log: FastifyBaseLogger, engine: EngineId): string {
    const trace = new RequestTrace(hub, requests, device.account_id, traceId);
    trace.accepted({ request_id: question.requestId, message_id: question.message.id });
    if (question.kind === "new") {
      trace.message(question.message);
    }
    answering.add(question.requestId);
    const onPower = (status: PowerStatus, eventId: string) => broadcastPower(device.account_id, eventId, status);
    const onMemory = (item: MemoryItem, eventId: string) => broadcastMemory(device.account_id, eventId, item);
    track(
      converse({ store, brain, power, memory, engine, trace, device, signal: stopping, log, onPower, onMemory }, question).finally(() => {
        answering.delete(question.requestId);
      }),
    );
    return trace.requestId;
  }

  app.get("/v1/messages", async (request) => {
    const device = requireSignedIn(request);
    const { limit } = HistoryQuery.parse(request.query);
    const live = requests.capture(device.account_id);
    return MessageHistory.parse(live.history(await store.listConversation(device.account_id, limit)));
  });

  app.post("/v1/messages", async (request, reply) => {
    const device = requireSignedIn(request);
    const { text } = SendMessage.parse(request.body);
    const engine = await power.admit(device.account_id, await availableEngines());
    const message = await save(device, request.id, text, request.log);
    const requestId = start(device, request.id, { kind: "new", message, requestId: request.id }, request.log, engine);
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
    const engine = await power.admit(device.account_id, await availableEngines());
    if (answering.has(request_id)) {
      throw conflict("VENOM is still answering this message.");
    }
    const requestId = start(device, request.id, { kind: "retry", message: asked.question, requestId: request_id }, request.log, engine);
    return reply.code(202).send(SendMessageAccepted.parse({ request_id: requestId }));
  });
}
