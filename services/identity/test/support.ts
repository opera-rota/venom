import { connect } from "@venom/db";
import { createTestDatabase, type TestDatabase } from "@venom/db/testing";
import type { Sql } from "postgres";
import { v7 as uuidv7 } from "uuid";
import { beginSecretWordLogin, beginSecretWordRegistration } from "../src/client.ts";
import { createEphemeralServerSetup, createIdentity, type Identity, type IdentityLimits } from "../src/index.ts";
import { deviceInfo, recordingMailer, type RecordingMailer } from "../src/testing.ts";

export { deviceInfo };

export interface IdentityHarness {
  readonly identity: Identity;
  readonly mailer: RecordingMailer;
  readonly owner: Sql;
  readonly app: Sql;
  close(): Promise<void>;
}

export async function startIdentity(limits: Partial<IdentityLimits> = {}): Promise<IdentityHarness> {
  const database: TestDatabase = await createTestDatabase();
  const owner = connect(database.migratorUrl, { max: 2 });
  const app = connect(database.appUrl, { max: 5 });
  const mailer = recordingMailer();
  const identity = createIdentity({ sql: app, mailer, serverSetup: await createEphemeralServerSetup(), limits });

  return {
    identity,
    mailer,
    owner,
    app,
    async close() {
      await Promise.all([owner.end(), app.end()]);
      await database.drop();
    },
  };
}

export async function signUp(harness: IdentityHarness, email: string, secretWord: string, name = "Ninette") {
  const { identity, mailer } = harness;
  const { signup_id } = await identity.startSignup({ name, email });
  await identity.verifySignup({ signup_id, code: mailer.lastCodeFor(email) });
  const flow = await beginSecretWordRegistration(secretWord);
  const { registration_response } = await identity.registerSecretWord({ signup_id, registration_request: flow.registrationRequest });
  return identity.finishSignup(
    { signup_id, registration_record: flow.finish(registration_response), device: deviceInfo("Work laptop") },
    uuidv7(),
  );
}

export async function proveSecretWord(harness: IdentityHarness, email: string, secretWord: string) {
  const flow = await beginSecretWordLogin(secretWord);
  const challenge = await harness.identity.startAttach({ email, start_login_request: flow.startLoginRequest });
  return { challenge, proof: flow.finish(challenge.login_response) };
}

export async function attach(harness: IdentityHarness, email: string, secretWord: string, name = "Second laptop") {
  const { challenge, proof } = await proveSecretWord(harness, email, secretWord);
  if (proof === null) {
    throw new Error("The secret word was refused");
  }
  await harness.identity.proveAttach({ attach_id: challenge.attach_id, secret_word_proof: proof }, uuidv7());
  return harness.identity.confirmAttach(
    { attach_id: challenge.attach_id, code: harness.mailer.lastCodeFor(email), device: deviceInfo(name) },
    uuidv7(),
  );
}
