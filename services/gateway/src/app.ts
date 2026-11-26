import websocket from "@fastify/websocket";
import { EngineId, liveProtocols, type Task } from "@venom/contracts";
import type { Kept, Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { Memory } from "@venom/memory";
import type { Availability, Power } from "@venom/power";
import type { CommandSigner, Trust } from "@venom/safety";
import type { Goals, Tasks } from "@venom/tasks";
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions, type RawServerDefault } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { createActing } from "./acting.ts";
import { identify } from "./auth.ts";
import type { Brain } from "./brain.ts";
import type { GatewayContext } from "./context.ts";
import { installErrorHandling } from "./errors.ts";
import { asksForLater, keptWords, laterTitle } from "./later.ts";
import { confirmationEvent, devicesEvent, forgottenEvent, haltEvent, howToEvent, howToRemovedEvent, laterEvent, laterRemovedEvent, LiveHub, memoryEvent, messageEvent, moveEvent, powerEvent, stepOutputEvent, taskEvent } from "./live-hub.ts";
import { GoalLoop, type LoopLimits } from "./loop.ts";
import { phoneRoutes, type PhoneApp } from "./phone.ts";
import { LiveRequests } from "./requests.ts";
import { TaskRunner, type SaidKind } from "./runner.ts";
import { deviceRoutes } from "./routes/devices.ts";
import { identityRoutes } from "./routes/identity.ts";
import { howToRoutes } from "./routes/howtos.ts";
import { laterRoutes } from "./routes/later.ts";
import { liveRoute } from "./routes/live.ts";
import { memoryRoutes } from "./routes/memory.ts";
import { messageRoutes } from "./routes/messages.ts";
import { powerRoutes } from "./routes/power.ts";
import { safetyRoutes } from "./routes/safety.ts";
import { screenRoutes } from "./routes/screen.ts";
import { taskRoutes } from "./routes/tasks.ts";

export { BrainError, brainEmbedder, createBrainClient, type Brain } from "./brain.ts";
export { closeCodes } from "./context.ts";

export interface GatewayOptions {
  readonly store: Store;
  readonly identity: Identity;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly tasks: Tasks;
  readonly goals: Goals;
  readonly trust: Trust;
  readonly signer: CommandSigner;
  readonly commandGraceMs?: number;
  readonly loopLimits?: Partial<LoopLimits>;
  readonly logger: NonNullable<FastifyServerOptions<RawServerDefault>["logger"]>;
  readonly heartbeatMs?: number;
  readonly phone?: PhoneApp | null;
}

const availabilityMs = 30_000;
const everyEngine: Availability = new Set(EngineId.options);

export async function buildGateway({ store, identity, brain, power, memory, tasks, goals, trust, signer, commandGraceMs, loopLimits, logger, heartbeatMs = 30_000, phone = null }: GatewayOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    genReqId: () => uuidv7(),
    logController: new LogController({ requestIdLogLabel: "request_id" }),
  });
  const hub = new LiveHub();
  const requests = new LiveRequests();
  const inflight = new Set<Promise<unknown>>();
  const stopping = new AbortController();
  let closing = false;
  let known: { readonly engines: Availability; readonly at: number } | null = null;
  const track = (work: Promise<unknown>) => {
    inflight.add(work);
    void work.finally(() => inflight.delete(work));
  };
  const tell = async (task: Task, kind: SaidKind, text: string, link: { readonly stepId?: string; readonly moveId?: string }) => {
    try {
      const message = await store.recordMessage({
        device: { id: task.origin_device_id, account_id: task.account_id },
        requestId: uuidv7(),
        speaker: "venom",
        kind,
        text,
        taskId: task.id,
        ...link,
      });
      hub.publishToAccount(task.account_id, messageEvent(uuidv7(), message));
    } catch (error) {
      app.log.error({ err: error, task_id: task.id }, "could not tell the chat about this task");
    }
  };
  const say = (task: Task, kind: SaidKind, text: string, stepId: string | null) => tell(task, kind, text, stepId === null ? {} : { stepId });
  const publishKept = (accountId: string, requestId: string, { item, dropped }: Kept) => {
    hub.publishToAccount(accountId, laterEvent(requestId, item));
    for (const itemId of dropped) {
      hub.publishToAccount(accountId, laterRemovedEvent(uuidv7(), itemId));
    }
  };
  const finished = async (task: Task) => {
    if (task.result === null || !asksForLater(task.request_text)) {
      return;
    }
    const device = { id: task.origin_device_id, account_id: task.account_id };
    try {
      const kept = await store.keepForLater({ device, requestId: uuidv7(), title: laterTitle(task.request_text), body: task.result, taskId: task.id });
      publishKept(task.account_id, uuidv7(), kept);
      const message = await store.recordMessage({ device, requestId: uuidv7(), speaker: "venom", text: keptWords });
      hub.publishToAccount(task.account_id, messageEvent(uuidv7(), message));
    } catch (error) {
      app.log.error({ err: error, task_id: task.id }, "could not keep the goal's result for later");
    }
  };
  const runner = new TaskRunner({
    tasks,
    signer,
    hub,
    log: app.log,
    closing: stopping.signal,
    ...(commandGraceMs === undefined ? {} : { graceMs: commandGraceMs }),
    track,
    publishTask: (accountId, requestId, task) => hub.publishToAccount(accountId, taskEvent(requestId, task)),
    publishConfirmation: (accountId, requestId, request, answered) => hub.publishToAccount(accountId, confirmationEvent(requestId, request, answered)),
    publishOutput: (accountId, requestId, taskId, stepId, chunk, text) => hub.publishToAccount(accountId, stepOutputEvent(requestId, taskId, stepId, chunk, text)),
    say,
  });
  const availableEngines = async (): Promise<Availability> => {
    if (known !== null && Date.now() - known.at < availabilityMs) {
      return known.engines;
    }
    try {
      known = { engines: new Set(await brain.engines()), at: Date.now() };
      return known.engines;
    } catch (error) {
      app.log.warn({ err: error }, "could not ask the brain which engines are available; offering all of them");
      return known?.engines ?? everyEngine;
    }
  };
  const loop = new GoalLoop({
    goals,
    tasks,
    brain,
    power,
    memory,
    identity,
    signer,
    hub,
    log: app.log,
    closing: stopping.signal,
    limits: { ...(commandGraceMs === undefined ? {} : { graceMs: commandGraceMs }), ...loopLimits },
    track,
    availableEngines,
    publishTask: (accountId, requestId, task) => hub.publishToAccount(accountId, taskEvent(requestId, task)),
    publishMove: (accountId, requestId, move, picture) => hub.publishToAccount(accountId, moveEvent(requestId, move, picture)),
    publishPower: (accountId, requestId, status) => hub.publishToAccount(accountId, powerEvent(requestId, status)),
    tell: (task, kind, text, moveId) => tell(task, kind, text, moveId === null ? {} : { moveId }),
    finished,
  });

  const shared: Omit<GatewayContext, "acting"> = {
    store,
    identity,
    hub,
    requests,
    brain,
    power,
    memory,
    tasks,
    goals,
    loop,
    trust,
    signer,
    runner,
    stopping: stopping.signal,
    heartbeatMs,
    track,
    isClosing: () => closing,
    async broadcastDevices(accountId, requestId) {
      hub.publishToAccount(accountId, devicesEvent(requestId, await identity.devices(accountId)));
    },
    broadcastPower(accountId, requestId, status) {
      hub.publishToAccount(accountId, powerEvent(requestId, status));
    },
    broadcastMemory(accountId, requestId, item) {
      hub.publishToAccount(accountId, memoryEvent(requestId, item));
    },
    broadcastForgotten(accountId, requestId, forgotten) {
      requests.forget(accountId, forgotten.message_ids);
      hub.publishToAccount(accountId, forgottenEvent(requestId, forgotten));
    },
    broadcastTask(accountId, requestId, task) {
      hub.publishToAccount(accountId, taskEvent(requestId, task));
    },
    broadcastConfirmation(accountId, requestId, request, answered) {
      hub.publishToAccount(accountId, confirmationEvent(requestId, request, answered));
    },
    broadcastHalt(accountId, requestId, receipt) {
      hub.publishToAccount(accountId, haltEvent(requestId, receipt));
    },
    broadcastKept: publishKept,
    broadcastLaterSeen(accountId, requestId, item) {
      hub.publishToAccount(accountId, laterEvent(requestId, item));
    },
    broadcastLaterRemoved(accountId, requestId, itemId) {
      hub.publishToAccount(accountId, laterRemovedEvent(requestId, itemId));
    },
    broadcastHowTo(accountId, requestId, howto) {
      hub.publishToAccount(accountId, howToEvent(requestId, howto));
    },
    broadcastHowToRemoved(accountId, requestId, howtoId) {
      hub.publishToAccount(accountId, howToRemovedEvent(requestId, howtoId));
    },
    say,
    availableEngines,
  };

  const context: GatewayContext = { ...shared, acting: createActing(shared) };

  app.decorateRequest("device", null);
  installErrorHandling(app);
  app.addHook("onRequest", identify(identity));
  app.addHook("preClose", async () => {
    closing = true;
  });
  app.addHook("onClose", async () => {
    closing = true;
    stopping.abort();
    await Promise.allSettled(inflight);
  });

  await app.register(websocket, {
    options: {
      maxPayload: 16 * 1024,
      handleProtocols: (protocols: ReadonlySet<string>) => (protocols.has(liveProtocols.link) ? liveProtocols.link : false),
    },
  });

  app.get("/healthz", async () => {
    await store.ping();
    return { status: "ok" };
  });

  identityRoutes(app, context);
  deviceRoutes(app, context);
  messageRoutes(app, context);
  powerRoutes(app, context);
  memoryRoutes(app, context);
  laterRoutes(app, context);
  howToRoutes(app, context);
  safetyRoutes(app, context);
  taskRoutes(app, context);
  screenRoutes(app, context);
  liveRoute(app, context);
  if (phone !== null) {
    phoneRoutes(app, phone);
  }

  return app;
}
