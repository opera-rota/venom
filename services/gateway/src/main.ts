import { createStore } from "@venom/db";
import { buildGateway } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const store = createStore(config.databaseUrl);
const app = await buildGateway({
  store,
  logger: {
    level: config.logLevel,
    ...(process.stdout.isTTY && {
      transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" } },
    }),
  },
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "gateway stopping");
  await app.close();
  await store.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await store.ping();
await app.listen({ host: config.host, port: config.port });
