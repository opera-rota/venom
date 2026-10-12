import websocket from "@fastify/websocket";
import { Id, MessageHistory, SendMessage, SendMessageAccepted } from "@venom/contracts";
import type { DeviceRef, Store } from "@venom/db";
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyServerOptions, type RawServerDefault } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { echoMessage } from "./echo.ts";
import { LiveHub, RequestTrace } from "./live-hub.ts";

export interface GatewayOptions {
  readonly store: Store;
  readonly logger: NonNullable<FastifyServerOptions<RawServerDefault>["logger"]>;
  readonly heartbeatMs?: number;
}

export class GatewayError extends Error {
  override readonly name = "GatewayError";
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const HistoryQuery = z.strictObject({
  device_id: Id,
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const LiveQuery = z.strictObject({
  device_id: Id,
});

export const closeCodes = {
  unknownDevice: 4404,
  invalidQuery: 4400,
} as const;

export async function buildGateway({ store, logger, heartbeatMs = 30_000 }: GatewayOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    genReqId: () => uuidv7(),
    logController: new LogController({ requestIdLogLabel: "request_id" }),
  });
  const hub = new LiveHub();
  const inflight = new Set<Promise<void>>();

  async function requireDevice(deviceId: string): Promise<DeviceRef> {
    const device = await store.findDevice(deviceId);
    if (device === null) {
      throw new GatewayError(404, "unknown_device", "This device is not registered with VENOM.");
    }
    return device;
  }

  function track(work: Promise<void>): void {
    inflight.add(work);
    void work.finally(() => inflight.delete(work));
  }

  app.setErrorHandler<FastifyError | z.ZodError | GatewayError>((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
      });
    }
    if (error instanceof GatewayError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
      return reply.code(statusCode).send({ error: "invalid_request", message: error.message });
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal", message: "VENOM hit an unexpected problem." });
  });

  app.addHook("onClose", async () => {
    await Promise.allSettled(inflight);
  });

  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.get("/healthz", async () => {
    await store.ping();
    return { status: "ok" };
  });

  app.get("/v1/messages", async (request) => {
    const query = HistoryQuery.parse(request.query);
    const device = await requireDevice(query.device_id);
    return MessageHistory.parse({ messages: await store.listMessages(device.account_id, query.limit) });
  });

  app.post("/v1/messages", async (request, reply) => {
    const body = SendMessage.parse(request.body);
    const device = await requireDevice(body.device_id);
    const trace = new RequestTrace(hub, device.id, request.id);

    trace.state("accepted");
    track(
      echoMessage(store, trace, device, body.text).catch((error: unknown) => {
        request.log.error({ err: error }, "message pipeline failed");
      }),
    );

    return reply.code(202).send(SendMessageAccepted.parse({ request_id: trace.requestId }));
  });

  app.get("/v1/live", { websocket: true }, (socket, request) => {
    const query = LiveQuery.safeParse(request.query);
    if (!query.success) {
      socket.close(closeCodes.invalidQuery, "device_id is required");
      return;
    }

    const deviceId = query.data.device_id;
    let alive = true;
    const unsubscribe = hub.subscribe(deviceId, (event) => socket.send(JSON.stringify(event)));
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, heartbeatMs);

    socket.on("pong", () => {
      alive = true;
    });
    socket.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    store.findDevice(deviceId).then(
      (device) => {
        if (device === null) {
          socket.close(closeCodes.unknownDevice, "unknown device");
        }
      },
      (error: unknown) => {
        request.log.error({ err: error }, "live connection check failed");
        socket.close(1011, "device check failed");
      },
    );
  });

  return app;
}
