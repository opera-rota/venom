import { TurnRequest, type EngineId, type MemoryContext, type MemoryItem, type Message, type PowerStatus, type TokenUsage, type TurnDone } from "@venom/contracts";
import type { DeviceRef, Store } from "@venom/db";
import { addUsage, detect, MemoryError, nothingUsed, type Memory } from "@venom/memory";
import type { Power } from "@venom/power";
import type { FastifyBaseLogger } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { BrainError, type Brain } from "./brain.ts";
import type { RequestTrace } from "./live-hub.ts";

export const historyLimit = 20;

export interface Exchange {
  readonly store: Store;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly engine: EngineId;
  readonly trace: RequestTrace;
  readonly device: DeviceRef;
  readonly signal: AbortSignal;
  readonly log: FastifyBaseLogger;
  onPower(status: PowerStatus, requestId: string): void;
  onMemory(item: MemoryItem, requestId: string): void;
}

export interface Question {
  readonly kind: "new" | "retry";
  readonly message: Message;
  readonly requestId: string;
}

interface Remembered {
  readonly context: MemoryContext;
  readonly usage: TokenUsage;
}

const unfinished = "VENOM could not finish this answer. Try again.";

export async function converse(exchange: Exchange, question: Question): Promise<void> {
  const { trace, log } = exchange;
  try {
    await answer(exchange, question);
  } catch (error) {
    if (error instanceof BrainError) {
      log.warn({ err: error.cause, problem: error.problem }, "the brain did not answer");
      trace.failed(error.message);
      return;
    }
    if (error instanceof MemoryError) {
      trace.failed(error.message);
      return;
    }
    log.error({ err: error }, "answering failed");
    trace.failed(unfinished);
  }
}

async function remember(exchange: Exchange, question: Question): Promise<Remembered | null> {
  const { memory, device, trace, onMemory } = exchange;
  if (question.kind === "retry") {
    const context = await memory.spokenIn(device.account_id, question.requestId);
    return context === null ? null : { context, usage: nothingUsed };
  }
  const draft = detect(question.message.text);
  if (draft === null) {
    return null;
  }
  const saved = await memory.save(device, trace.requestId, draft, { kind: "chat", requestId: trace.requestId });
  onMemory(saved.item, uuidv7());
  return {
    context: { type: saved.item.type, content: saved.item.content, saved_at: saved.item.updated_at },
    usage: saved.usage,
  };
}

async function answer(exchange: Exchange, question: Question): Promise<void> {
  const { store, brain, memory, engine, trace, device, signal } = exchange;
  const asked = question.message;
  const remembered = await remember(exchange, question);
  const [history, recall] = await Promise.all([
    store.conversationBefore(device.account_id, asked.id, historyLimit),
    memory.recall(device.account_id, asked.text, trace.requestId),
  ]);
  const request = TurnRequest.parse({
    request_id: trace.requestId,
    account_id: device.account_id,
    device_id: device.id,
    engine,
    history,
    memories: recall.memories.filter((item) => item.content !== remembered?.context.content),
    remembered: remembered?.context ?? null,
    text: asked.text,
  });
  const spentBeforeAnswer = addUsage(recall.usage, remembered?.usage ?? nothingUsed);

  for await (const event of brain.turn(request, signal)) {
    switch (event.type) {
      case "delta":
        trace.answer(event.text);
        break;
      case "done": {
        const reply = await store.recordMessage({
          device,
          requestId: question.requestId,
          speaker: "venom",
          text: event.text,
          answer: { model: event.model, intent: event.intent },
        });
        trace.message(reply);
        await charge(exchange, event, spentBeforeAnswer);
        trace.completed();
        return;
      }
      case "failed":
        trace.failed(event.detail);
        return;
    }
  }
  throw new BrainError("malformed", { cause: new Error("the brain stream ended without a result") });
}

async function charge({ power, engine, device, trace, log, onPower }: Exchange, done: TurnDone, spentBeforeAnswer: TokenUsage): Promise<void> {
  try {
    const usage = addUsage(done.usage, spentBeforeAnswer);
    const status = await power.charge({ device, requestId: trace.requestId, engine, model: done.model, usage });
    onPower(status, uuidv7());
  } catch (error) {
    log.error({ err: error, engine }, "could not record the power this answer used");
  }
}
