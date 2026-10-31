import type { DeviceSession } from "@venom/contracts";
import { connect, createStore, type Store } from "@venom/db";
import { createTestDatabase, type TestDatabase } from "@venom/db/testing";
import { brainEmbedder, buildGateway } from "@venom/gateway";
import { scriptedBrain, type ScriptedBrain } from "@venom/gateway/testing";
import { createEphemeralServerSetup, createIdentity } from "@venom/identity";
import { deviceInfo, recordingMailer, type RecordingMailer } from "@venom/identity/testing";
import { createMemory } from "@venom/memory";
import { createPower } from "@venom/power";
import { createCommandSigner, createTrust, newKeyPair } from "@venom/safety";
import { createTasks } from "@venom/tasks";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { Api } from "../src/main/api.ts";
import { Onboarding } from "../src/main/onboarding.ts";
import type { Encryptor } from "../src/main/vault.ts";

export interface Backend {
  readonly mailer: RecordingMailer;
  readonly brain: ScriptedBrain;
  readonly url: () => string;
  start(port?: number): Promise<number>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}

export async function createBackend(): Promise<Backend> {
  const database: TestDatabase = await createTestDatabase();
  const mailer = recordingMailer();
  const serverSetup = await createEphemeralServerSetup();
  const brain = scriptedBrain();
  const commandKey = newKeyPair();
  let running: { app: FastifyInstance; store: Store; sql: Sql } | null = null;
  let lastPort = 0;

  async function stop(): Promise<void> {
    if (running === null) {
      return;
    }
    const { app, store, sql } = running;
    running = null;
    await app.close();
    await Promise.all([store.close(), sql.end()]);
  }

  return {
    mailer,
    brain,
    stop,
    url: () => `http://127.0.0.1:${lastPort}`,
    async start(port = 0) {
      const store = createStore(database.appUrl);
      const sql = connect(database.appUrl);
      const identity = createIdentity({ sql, mailer, serverSetup });
      const power = createPower({ sql });
      const memory = createMemory({ sql, embedder: brainEmbedder(brain) });
      const signer = createCommandSigner(commandKey);
      const tasks = createTasks({ sql });
      const trust = createTrust({ sql, serverKey: signer.publicKey });
      const app = await buildGateway({ store, identity, brain, power, memory, tasks, trust, signer, logger: false });
      await app.listen({ host: "127.0.0.1", port });
      const address = app.server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Gateway has no port");
      }
      lastPort = address.port;
      running = { app, store, sql };
      return address.port;
    },
    async destroy() {
      await stop();
      await database.drop();
    },
  };
}

export function onboardingFor(baseUrl: string, name: string) {
  const sessions: DeviceSession[] = [];
  const onboarding = new Onboarding({
    api: new Api(baseUrl),
    device: () => deviceInfo(name),
    complete: async (session) => {
      sessions.push(session);
    },
  });
  return { onboarding, sessions };
}

export async function createAccount(backend: Backend, email: string, secretWord: string): Promise<DeviceSession> {
  const { onboarding, sessions } = onboardingFor(backend.url(), "Work laptop");
  await expectOk(onboarding.startSignup("Ninette", email));
  await expectOk(onboarding.verifySignup(backend.mailer.lastCodeFor(email)));
  await expectOk(onboarding.chooseSecretWord(secretWord, secretWord));
  const session = sessions.at(-1);
  if (session === undefined) {
    throw new Error("Sign up did not complete");
  }
  return session;
}

export async function expectOk(result: Promise<{ ok: boolean; reason?: string }>): Promise<void> {
  const settled = await result;
  if (!settled.ok) {
    throw new Error(`Expected success, got: ${settled.reason ?? "unknown failure"}`);
  }
}

export const testEncryptor: Encryptor = {
  available: () => true,
  encrypt: (plain) => Buffer.from(Buffer.from(plain, "utf8").map((byte) => byte ^ 0x5a)),
  decrypt: (sealed) => Buffer.from(sealed.map((byte) => byte ^ 0x5a)).toString("utf8"),
};
