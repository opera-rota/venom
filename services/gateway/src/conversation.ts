import { TurnRequest, type EngineId, type Message, type PowerStatus, type TurnDone } from "@venom/contracts";
import type { DeviceRef, Store } from "@venom/db";
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
  readonly engine: EngineId;
  readonly trace: RequestTrace;
  readonly device: DeviceRef;
  readonly signal: AbortSignal;
  readonly log: FastifyBaseLogger;
  onPower(status: PowerStatus, requestId: string): void;
}

export type Question = { readonly kind: "new"; readonly text: string } | { readonly kind: "retry"; readonly message: Message; readonly requestId: string };

const unsaved = "VENOM could not save this message. Try sending it again.";
const unfinished = "VENOM could not finish this answer. Try again.";

export async function converse(exchange: Exchange, question: Question): Promise<void> {
  const { store, trace, device, log } = exchange;
  let asked: Message;
  try {
    asked = question.kind === "new" ? await store.recordMessage({ device, requestId: trace.requestId, speaker: "user", text: question.text }) : question.message;
  } catch (error) {
    log.error({ err: error }, "could not record the message");
    trace.state("failed", unsaved);
    return;
  }
  if (question.kind === "new") {
    trace.message(asked);
  }

  try {
    await answer(exchange, asked, question.kind === "new" ? trace.requestId : question.requestId);
  } catch (error) {
    if (error instanceof BrainError) {
      log.warn({ err: error.cause, problem: error.problem }, "the brain did not answer");
      trace.state("failed", error.message);
      return;
    }
    log.error({ err: error }, "answering failed");
    trace.state("failed", unfinished);
  }
}

async function answer(exchange: Exchange, asked: Message, answerRequestId: string): Promise<void> {
  const { store, brain, engine, trace, device, signal } = exchange;
  const history = await store.conversationBefore(device.account_id, asked.id, historyLimit);
  const request = TurnRequest.parse({
    request_id: trace.requestId,
    account_id: device.account_id,
    device_id: device.id,
    engine,
    history,
    text: asked.text,
  });

  for await (const event of brain.turn(request, signal)) {
    switch (event.type) {
      case "delta":
        trace.answer(event.text);
        break;
      case "done": {
        const reply = await store.recordMessage({
          device,
          requestId: answerRequestId,
          speaker: "venom",
          text: event.text,
          answer: { model: event.model, intent: event.intent },
        });
        trace.message(reply);
        await charge(exchange, event);
        trace.state("completed");
        return;
      }
      case "failed":
        trace.state("failed", event.detail);
        return;
    }
  }
  throw new BrainError("malformed", { cause: new Error("the brain stream ended without a result") });
}

async function charge({ power, engine, device, trace, log, onPower }: Exchange, done: TurnDone): Promise<void> {
  try {
    const status = await power.charge({ device, requestId: trace.requestId, engine, model: done.model, usage: done.usage });
    onPower(status, uuidv7());
  } catch (error) {
    log.error({ err: error, engine }, "could not record the power this answer used");
  }
}
