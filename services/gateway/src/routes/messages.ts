import { MessageHistory, RetryAnswer, SendMessage, SendMessageAccepted, type EngineId, type MemoryItem, type Message, type PowerStatus, type Task } from "@venom/contracts";
import type { DeviceRef } from "@venom/db";
import { SafetyError } from "@venom/safety";
import { TaskError } from "@venom/tasks";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSignedIn } from "../auth.ts";
import type { GatewayContext } from "../context.ts";
import { decide, obey, type Command } from "../chat.ts";
import { converse, type Question } from "../conversation.ts";
import { conflict, GatewayError, notFound, unsaved } from "../errors.ts";
import { RequestTrace } from "../live-hub.ts";

const notDone = "VENOM could not do that. Try again.";

const HistoryQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function messageRoutes(app: FastifyInstance, context: GatewayContext): void {
  const { store, hub, requests, brain, power, memory, tasks, goals, loop, identity, stopping, track, availableEngines, broadcastPower, broadcastMemory, broadcastTask } = context;
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
    const onTask = (task: Task, eventId: string) => broadcastTask(device.account_id, eventId, task);
    track(
      converse({ store, brain, power, memory, tasks, identity, loop, engine, trace, device, signal: stopping, log, onPower, onMemory, onTask }, question).finally(() => {
        answering.delete(question.requestId);
      }),
    );
    return trace.requestId;
  }

  async function carryOut(device: DeviceRef, requestId: string, message: Message, command: Command, log: FastifyBaseLogger): Promise<void> {
    const trace = new RequestTrace(hub, requests, device.account_id, requestId);
    trace.accepted({ request_id: requestId, message_id: message.id });
    trace.message(message);
    try {
      const text = await answerOf(device, requestId, command, log);
      trace.message(await store.recordMessage({ device, requestId, speaker: "venom", text }));
      trace.completed();
    } catch (error) {
      log.error({ err: error }, "could not record the reply to a chat command");
      trace.failed(notDone);
    }
  }

  async function answerOf(device: DeviceRef, requestId: string, command: Command, log: FastifyBaseLogger): Promise<string> {
    try {
      return await obey(context, device, requestId, command);
    } catch (error) {
      if (error instanceof TaskError || error instanceof SafetyError || error instanceof GatewayError) {
        return error.message;
      }
      log.error({ err: error, command: command.kind }, "a chat command failed");
      return notDone;
    }
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
    const command = await decide(tasks, goals, device.account_id, text);
    if (command !== null) {
      const message = await save(device, request.id, text, request.log);
      track(carryOut(device, request.id, message, command, request.log));
      return reply.code(202).send(SendMessageAccepted.parse({ request_id: request.id }));
    }
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
