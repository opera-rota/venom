import websocket from "@fastify/websocket";
import type { Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions, type RawServerDefault } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { identify } from "./auth.ts";
import type { GatewayContext } from "./context.ts";
import { installErrorHandling } from "./errors.ts";
import { devicesEvent, LiveHub } from "./live-hub.ts";
import { deviceRoutes } from "./routes/devices.ts";
import { identityRoutes } from "./routes/identity.ts";
import { liveRoute } from "./routes/live.ts";
import { messageRoutes } from "./routes/messages.ts";

export { closeCodes } from "./context.ts";

export interface GatewayOptions {
  readonly store: Store;
  readonly identity: Identity;
  readonly logger: NonNullable<FastifyServerOptions<RawServerDefault>["logger"]>;
  readonly heartbeatMs?: number;
}

export async function buildGateway({ store, identity, logger, heartbeatMs = 30_000 }: GatewayOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    genReqId: () => uuidv7(),
    logController: new LogController({ requestIdLogLabel: "request_id" }),
  });
  const hub = new LiveHub();
  const inflight = new Set<Promise<unknown>>();
  let closing = false;

  const context: GatewayContext = {
    store,
    identity,
    hub,
    heartbeatMs,
    track(work) {
      inflight.add(work);
      void work.finally(() => inflight.delete(work));
    },
    isClosing: () => closing,
    async broadcastDevices(accountId, requestId) {
      hub.publishToAccount(accountId, devicesEvent(requestId, await identity.devices(accountId)));
    },
  };

  app.decorateRequest("device", null);
  installErrorHandling(app);
  app.addHook("onRequest", identify(identity));
  app.addHook("onClose", async () => {
    closing = true;
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
  liveRoute(app, context);

  return app;
}
