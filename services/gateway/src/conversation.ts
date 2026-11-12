import { TurnRequest, type Device, type EngineId, type MemoryContext, type MemoryItem, type Message, type MessageKind, type PlanDraft, type PowerStatus, type Task, type TokenUsage, type TurnDone } from "@venom/contracts";
import type { DeviceRef, Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import { addUsage, detect, MemoryError, nothingUsed, type Memory } from "@venom/memory";
import type { Power } from "@venom/power";
import { route, TaskError, type RoutedPlan, type Tasks } from "@venom/tasks";
import type { FastifyBaseLogger } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { BrainError, type Brain } from "./brain.ts";
import type { RequestTrace } from "./live-hub.ts";
import type { GoalLoop } from "./loop.ts";
import { goalStartWords, planWaiting } from "./words.ts";

export const historyLimit = 20;

export interface Exchange {
  readonly store: Store;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly tasks: Tasks;
  readonly identity: Pick<Identity, "devices">;
  readonly loop: GoalLoop;
  readonly engine: EngineId;
  readonly trace: RequestTrace;
  readonly device: DeviceRef;
  readonly signal: AbortSignal;
  readonly log: FastifyBaseLogger;
  onPower(status: PowerStatus, requestId: string): void;
  onMemory(item: MemoryItem, requestId: string): void;
  onTask(task: Task, requestId: string): void;
}

interface Reply {
  readonly text: string;
  readonly taskId: string | null;
  readonly kind: MessageKind;
  readonly started?: { readonly task: Task; readonly target: Device };
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
  const { store, brain, memory, loop, engine, trace, device, signal } = exchange;
  const asked = question.message;
  const remembered = await remember(exchange, question);
  const [history, recall, target] = await Promise.all([
    store.conversationBefore(device.account_id, asked.id, historyLimit),
    memory.recall(device.account_id, asked.text, trace.requestId),
    loop.target(device),
  ]);
  const request = TurnRequest.parse({
    request_id: trace.requestId,
    account_id: device.account_id,
    device_id: device.id,
    engine,
    history,
    memories: recall.memories.filter((item) => item.content !== remembered?.context.content),
    remembered: remembered?.context ?? null,
    connectors: [],
    task_mode: target === null ? "plan" : "loop",
    text: asked.text,
  });
  const spentBeforeAnswer = addUsage(recall.usage, remembered?.usage ?? nothingUsed);

  for await (const event of brain.turn(request, signal)) {
    switch (event.type) {
      case "delta":
        trace.answer(event.text);
        break;
      case "done": {
        const { text, taskId, kind, started } = event.plan !== null
          ? await planned(exchange, asked, event.plan)
          : event.intent === "task" && target !== null
            ? await goal(exchange, asked, target)
            : { text: event.text, taskId: null, kind: "text" as const };
        const reply = await store.recordMessage({
          device,
          requestId: question.requestId,
          speaker: "venom",
          kind,
          text,
          ...(taskId === null ? {} : { taskId }),
          answer: { model: event.model, intent: event.intent },
        });
        trace.message(reply);
        if (started !== undefined) {
          loop.run(started.task, started.target, trace.requestId);
        }
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

function asks(asking: number, total: number): string {
  if (asking === 0) {
    return "";
  }
  if (asking === total) {
    return total === 1 ? ", and I would ask you before it" : ", and I would ask you before each of them";
  }
  return `, and I would ask you before ${asking} of them`;
}

export function planReply(plan: RoutedPlan, task: Task): string {
  const total = task.plan.length;
  const asking = task.plan.filter((step) => step.requires_confirmation).length;
  return [
    `Here is my plan: ${plan.title}.`,
    plan.elsewhere ? `This device cannot do it, so I planned it for ${plan.target.name}.` : "",
    `It has ${total} ${total === 1 ? "step" : "steps"}${asks(asking, total)}.`,
    plan.missing ?? "",
    plan.missing === null ? `Nothing has run yet. ${planWaiting}` : "Nothing has been done.",
  ]
    .filter((line) => line !== "")
    .join(" ");
}

async function planned({ tasks, identity, device, trace, onTask }: Exchange, asked: Message, draft: PlanDraft): Promise<Reply> {
  const devices = await identity.devices(device.account_id);
  const origin = devices.find((candidate) => candidate.id === device.id);
  if (origin === undefined) {
    return { text: "I could not find this device in your VENOM, so I did not plan anything.", taskId: null, kind: "text" };
  }
  const routing = route(draft, { origin, devices, connectors: [] });
  if (routing.kind === "refused") {
    return { text: routing.reason, taskId: null, kind: "text" };
  }
  const task = await tasks.plan(device, asked.text, routing.plan, trace.requestId);
  onTask(task, uuidv7());
  return { text: planReply(routing.plan, task), taskId: task.id, kind: "plan" };
}

async function goal({ loop, device, trace, onTask }: Exchange, asked: Message, target: Device): Promise<Reply> {
  try {
    const task = await loop.begin(device, asked.text, target, trace.requestId);
    onTask(task, uuidv7());
    return { text: goalStartWords(task, target.name, target.id !== device.id), taskId: task.id, kind: "report", started: { task, target } };
  } catch (error) {
    if (error instanceof TaskError) {
      return { text: error.message, taskId: null, kind: "text" };
    }
    throw error;
  }
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
