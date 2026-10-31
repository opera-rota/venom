import { connect, createStore } from "@venom/db";
import { createIdentity, createSmtpMailer, loadServerSetup } from "@venom/identity";
import { createMemory } from "@venom/memory";
import { createPower } from "@venom/power";
import { createCommandSigner, createTasks, createTrust, loadCommandKey } from "@venom/safety";
import { v7 as uuidv7 } from "uuid";
import { brainEmbedder, buildGateway, createBrainClient } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const store = createStore(config.databaseUrl);
const serviceSql = connect(config.databaseUrl);
const mailer = createSmtpMailer({ url: config.smtpUrl, from: config.mailFrom });
const serverSetup = await loadServerSetup(config.identityKeyFile);
const identity = createIdentity({ sql: serviceSql, mailer, serverSetup: serverSetup.value });

const commandKey = await loadCommandKey(config.commandKeyFile);
const signer = createCommandSigner(commandKey.pair);
const trust = createTrust({ sql: serviceSql, serverKey: signer.publicKey });
const tasks = createTasks({ sql: serviceSql });
const power = createPower({ sql: serviceSql, freeDailyAnswers: config.freeDailyAnswers });
const brain = createBrainClient({ url: config.brainUrl });
const memory = createMemory({
  sql: serviceSql,
  embedder: brainEmbedder(brain),
  onEmbeddingProblem: (error) => app.log.warn({ err: error }, "could not embed memory; it is found by its words until the brain can embed again"),
});
const backfillEveryMs = 10 * 60_000;

const app = await buildGateway({
  store,
  identity,
  brain,
  power,
  memory,
  tasks,
  trust,
  signer,
  logger: {
    level: config.logLevel,
    ...(process.stdout.isTTY && {
      transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" } },
    }),
  },
});

async function backfill(): Promise<void> {
  try {
    const embedded = await memory.backfill(uuidv7());
    if (embedded > 0) {
      app.log.info({ embedded }, "filled in the meaning of saved memories");
    }
  } catch (error) {
    app.log.warn({ err: error }, "could not fill in the meaning of saved memories");
  }
}

const backfillTimer = setInterval(() => void backfill(), backfillEveryMs);
backfillTimer.unref();

if (commandKey.created) {
  app.log.warn({ file: config.commandKeyFile }, "created a new command key; back this file up, every device trusts it");
}

if (serverSetup.created) {
  app.log.warn({ file: config.identityKeyFile }, "created a new identity key; back this file up, accounts depend on it");
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "gateway stopping");
  clearInterval(backfillTimer);
  await app.close();
  await identity.resetPresence();
  mailer.close();
  await Promise.all([store.close(), serviceSql.end({ timeout: 5 })]);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await store.ping();
await identity.resetPresence();
const interrupted = await tasks.interruptAll();
if (interrupted > 0) {
  app.log.warn({ tasks: interrupted }, "marked tasks that were running before the gateway restarted as failed");
}
await app.listen({ host: config.host, port: config.port });
await checkBrain();
await backfill();

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
