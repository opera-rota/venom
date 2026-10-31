import { DeviceSession, GatewayEvent, type DeviceInfo } from "@venom/contracts";
import { connect, createStore, type Store } from "@venom/db";
import { createTestDatabase, type TestDatabase } from "@venom/db/testing";
import { createEphemeralServerSetup, createIdentity, type Identity } from "@venom/identity";
import { beginSecretWordLogin, beginSecretWordRegistration } from "@venom/identity/client";
import { deviceInfo, recordingMailer, type RecordingMailer } from "@venom/identity/testing";
import { createPower, type Power } from "@venom/power";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { buildGateway } from "../src/app.ts";
import { scriptedBrain, type ScriptedBrain } from "../src/testing.ts";

export interface Environment {
  readonly database: TestDatabase;
  readonly mailer: RecordingMailer;
  readonly serverSetup: string;
  readonly owner: Sql;
}

export interface RunningGateway {
  readonly base: string;
  readonly app: FastifyInstance;
  readonly identity: Identity;
  readonly brain: ScriptedBrain;
  readonly power: Power;
  stop(): Promise<void>;
}

export async function createEnvironment(): Promise<Environment> {
  const database = await createTestDatabase();
  return {
    database,
    mailer: recordingMailer(),
    serverSetup: await createEphemeralServerSetup(),
    owner: connect(database.migratorUrl, { max: 2 }),
  };
}

export async function destroyEnvironment(environment: Environment | undefined): Promise<void> {
  await environment?.owner.end();
  await environment?.database.drop();
}

export interface GatewayStart {
  readonly heartbeatMs?: number;
  readonly brain?: ScriptedBrain;
  readonly freeDailyAnswers?: number;
}

export async function startGateway(
  environment: Environment,
  { heartbeatMs, brain = scriptedBrain(), freeDailyAnswers = 100 }: GatewayStart = {},
): Promise<RunningGateway> {
  const store: Store = createStore(environment.database.appUrl);
  const sql = connect(environment.database.appUrl);
  const identity = createIdentity({ sql, mailer: environment.mailer, serverSetup: environment.serverSetup });
  const power = createPower({ sql, freeDailyAnswers });
  const app = await buildGateway({ store, identity, brain, power, logger: false, ...(heartbeatMs === undefined ? {} : { heartbeatMs }) });
  const base = await app.listen({ host: "127.0.0.1", port: 0 });

  return {
    base,
    app,
    identity,
    brain,
    power,
    async stop() {
      await app.close();
      await Promise.all([store.close(), sql.end()]);
    },
  };
}

export async function call(base: string, method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function expectStatus(response: Response, status: number): Promise<unknown> {
  const body: unknown = response.status === 204 ? null : await response.json();
  if (response.status !== status) {
    throw new Error(`Expected ${status}, got ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export async function signUpOverHttp(
  base: string,
  mailer: RecordingMailer,
  email: string,
  secretWord: string,
  device: DeviceInfo = deviceInfo("Work laptop"),
): Promise<DeviceSession> {
  const started = (await expectStatus(await call(base, "POST", "/v1/signup", { body: { name: "Ninette", email } }), 201)) as { signup_id: string };
  await expectStatus(
    await call(base, "POST", "/v1/signup/verify", { body: { signup_id: started.signup_id, code: mailer.lastCodeFor(email) } }),
    204,
  );
  const flow = await beginSecretWordRegistration(secretWord);
  const registered = (await expectStatus(
    await call(base, "POST", "/v1/signup/secret-word", { body: { signup_id: started.signup_id, registration_request: flow.registrationRequest } }),
    200,
  )) as { registration_response: string };
  return DeviceSession.parse(
    await expectStatus(
      await call(base, "POST", "/v1/signup/finish", {
        body: { signup_id: started.signup_id, registration_record: flow.finish(registered.registration_response), device },
      }),
      201,
    ),
  );
}

export async function attachOverHttp(
  base: string,
  mailer: RecordingMailer,
  email: string,
  secretWord: string,
  device: DeviceInfo = deviceInfo("Second laptop"),
): Promise<DeviceSession> {
  const flow = await beginSecretWordLogin(secretWord);
  const challenge = (await expectStatus(
    await call(base, "POST", "/v1/attach", { body: { email, start_login_request: flow.startLoginRequest } }),
    201,
  )) as { attach_id: string; login_response: string };
  const proof = flow.finish(challenge.login_response);
  if (proof === null) {
    throw new Error("The secret word was refused on the device");
  }
  await expectStatus(await call(base, "POST", "/v1/attach/prove", { body: { attach_id: challenge.attach_id, secret_word_proof: proof } }), 200);
  return DeviceSession.parse(
    await expectStatus(
      await call(base, "POST", "/v1/attach/confirm", { body: { attach_id: challenge.attach_id, code: mailer.lastCodeFor(email), device } }),
      201,
    ),
  );
}

export function openLive(base: string, token?: string) {
  const socket = new WebSocket(`${base.replace("http", "ws")}/v1/live`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  const events: GatewayEvent[] = [];
  const waiters = new Set<() => void>();

  socket.addEventListener("message", ({ data }) => {
    events.push(GatewayEvent.parse(JSON.parse(String(data))));
    for (const wake of waiters) wake();
  });

  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("live connection failed")), { once: true });
  });

  const closed = new Promise<number>((resolve) => {
    socket.addEventListener("close", ({ code }) => resolve(code), { once: true });
  });

  function until<T extends GatewayEvent>(match: (event: GatewayEvent) => event is T): Promise<T>;
  function until(match: (event: GatewayEvent) => boolean): Promise<GatewayEvent>;
  function until(match: (event: GatewayEvent) => boolean): Promise<GatewayEvent> {
    return new Promise((resolve) => {
      const check = () => {
        const found = events.find(match);
        if (found !== undefined) {
          waiters.delete(check);
          resolve(found);
        }
      };
      waiters.add(check);
      check();
    });
  }

  function settled(requestId: string): Promise<GatewayEvent[]> {
    return until((event) => event.request_id === requestId && event.type === "request" && event.state !== "accepted").then(() =>
      events.filter((event) => event.request_id === requestId),
    );
  }

  return { socket, events, opened, closed, until, settled };
}
