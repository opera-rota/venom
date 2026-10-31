import websocket from "@fastify/websocket";
import { EngineId } from "@venom/contracts";
import type { Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { Memory } from "@venom/memory";
import type { Availability, Power } from "@venom/power";
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions, type RawServerDefault } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { identify } from "./auth.ts";
import type { Brain } from "./brain.ts";
import type { GatewayContext } from "./context.ts";
import { installErrorHandling } from "./errors.ts";
import { devicesEvent, forgottenEvent, LiveHub, memoryEvent, powerEvent } from "./live-hub.ts";
import { LiveRequests } from "./requests.ts";
import { deviceRoutes } from "./routes/devices.ts";
import { identityRoutes } from "./routes/identity.ts";
import { liveRoute } from "./routes/live.ts";
import { memoryRoutes } from "./routes/memory.ts";
import { messageRoutes } from "./routes/messages.ts";
import { powerRoutes } from "./routes/power.ts";

export { BrainError, brainEmbedder, createBrainClient, type Brain } from "./brain.ts";
export { closeCodes } from "./context.ts";

export interface GatewayOptions {
  readonly store: Store;
  readonly identity: Identity;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly logger: NonNullable<FastifyServerOptions<RawServerDefault>["logger"]>;
  readonly heartbeatMs?: number;
}

const availabilityMs = 30_000;
const everyEngine: Availability = new Set(EngineId.options);

export async function buildGateway({ store, identity, brain, power, memory, logger, heartbeatMs = 30_000 }: GatewayOptions): Promise<FastifyInstance> {
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

  const context: GatewayContext = {
    store,
    identity,
    hub,
    requests,
    brain,
    power,
    memory,
    stopping: stopping.signal,
    heartbeatMs,
    track(work) {
      inflight.add(work);
      void work.finally(() => inflight.delete(work));
    },
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
    async availableEngines() {
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
    },
  };

  app.decorateRequest("device", null);
  installErrorHandling(app);
  app.addHook("onRequest", identify(identity));
  app.addHook("onClose", async () => {
    closing = true;
    stopping.abort();
    await Promise.allSettled(inflight);
  });

  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.get("/healthz", async () => {
    await store.ping();
    return { status: "ok" };
  });

  identityRoutes(app, context);
  deviceRoutes(app, context);
  messageRoutes(app, context);
  powerRoutes(app, context);
  memoryRoutes(app, context);
  liveRoute(app, context);

  return app;
}
