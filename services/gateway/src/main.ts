import { connect, createStore } from "@venom/db";
import { createIdentity, createSmtpMailer, loadServerSetup } from "@venom/identity";
import { createPower } from "@venom/power";
import { buildGateway, createBrainClient } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const store = createStore(config.databaseUrl);
const serviceSql = connect(config.databaseUrl);
const mailer = createSmtpMailer({ url: config.smtpUrl, from: config.mailFrom });
const serverSetup = await loadServerSetup(config.identityKeyFile);
const identity = createIdentity({ sql: serviceSql, mailer, serverSetup: serverSetup.value });

const power = createPower({ sql: serviceSql, freeDailyAnswers: config.freeDailyAnswers });
const brain = createBrainClient({ url: config.brainUrl });

const app = await buildGateway({
  store,
  identity,
  brain,
  power,
  logger: {
    level: config.logLevel,
    ...(process.stdout.isTTY && {
      transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" } },
    }),
  },
});

if (serverSetup.created) {
  app.log.warn({ file: config.identityKeyFile }, "created a new identity key; back this file up, accounts depend on it");
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "gateway stopping");
  await app.close();
  await identity.resetPresence();
  mailer.close();
  await Promise.all([store.close(), serviceSql.end({ timeout: 5 })]);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await store.ping();
await identity.resetPresence();
await app.listen({ host: config.host, port: config.port });
await checkBrain();

async function checkBrain(): Promise<void> {
  try {
    const response = await fetch(new URL("/healthz", config.brainUrl), { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      const engines = await brain.engines();
      app.log.info({ brain: config.brainUrl, engines: engines.length }, "brain is reachable");
      return;
    }
  } catch {}
  app.log.warn({ brain: config.brainUrl }, "brain is not reachable yet; start it with: pnpm brain");
}
