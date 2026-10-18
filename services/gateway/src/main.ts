import { connect, createStore } from "@venom/db";
import { createIdentity, createSmtpMailer, loadServerSetup } from "@venom/identity";
import { buildGateway } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const store = createStore(config.databaseUrl);
const identitySql = connect(config.databaseUrl);
const mailer = createSmtpMailer({ url: config.smtpUrl, from: config.mailFrom });
const serverSetup = await loadServerSetup(config.identityKeyFile);
const identity = createIdentity({ sql: identitySql, mailer, serverSetup: serverSetup.value });

const app = await buildGateway({
  store,
  identity,
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
  await Promise.all([store.close(), identitySql.end({ timeout: 5 })]);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await store.ping();
await identity.resetPresence();
await app.listen({ host: config.host, port: config.port });
