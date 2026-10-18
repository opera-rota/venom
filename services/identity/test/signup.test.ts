import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginSecretWordRegistration } from "../src/client.ts";
import { deviceInfo, signUp, startIdentity, type IdentityHarness } from "./support.ts";

let harness: IdentityHarness;

beforeAll(async () => {
  harness = await startIdentity();
});

afterAll(async () => {
  await harness?.close();
});

describe("creating an account", () => {
  it("creates the account and its first device after the email code and secret word", async () => {
    const session = await signUp(harness, "ninette@venom.test", "blue horse river");

    expect(session.account).toMatchObject({ name: "Ninette", email: "ninette@venom.test" });
    expect(session.device).toMatchObject({ account_id: session.account.id, name: "Work laptop", status: "registered" });
    expect(session.device_token).toMatch(/^vnm_/);
    expect(await harness.identity.authenticate(session.device_token)).toEqual({ id: session.device.id, account_id: session.account.id });

    const [verified] = await harness.owner`select email_verified_at from accounts where id = ${session.account.id}`;
    expect(verified?.["email_verified_at"]).toBeInstanceOf(Date);

    const audit = await harness.owner`select action from audit_log where account_id = ${session.account.id} order by id`;
    expect(audit.map((row) => row["action"])).toEqual(["account.created", "device.attached"]);
  });

  it("never stores or logs the secret word or the device token in plain form", async () => {
    const secretWord = "purple lantern ocean";
    const session = await signUp(harness, "plain@venom.test", secretWord);
    const [dump] = await harness.owner`
      select concat_ws(' ',
        (select string_agg(encode(opaque_record, 'escape'), ' ') from account_secrets),
        (select string_agg(encode(credential_hash, 'escape'), ' ') from devices),
        (select string_agg(detail::text, ' ') from audit_log),
        (select string_agg(row_to_json(s)::text, ' ') from signups s)
      ) as everything
    `;
    const everything = String(dump?.["everything"]);
    expect(everything).not.toContain(secretWord);
    expect(everything).not.toContain(session.device_token);
  });

  it("refuses a wrong code, counts down, then locks the signup", async () => {
    const { signup_id } = await harness.identity.startSignup({ name: "Locked", email: "locked@venom.test" });
    const right = harness.mailer.lastCodeFor("locked@venom.test");
    const wrong = right === "000000" ? "111111" : "000000";

    for (const left of [4, 3, 2, 1, 0]) {
      await expect(harness.identity.verifySignup({ signup_id, code: wrong })).rejects.toMatchObject({
        code: "code_incorrect",
        message: expect.stringContaining(left === 1 ? "1 try left" : `${left} tries left`),
      });
    }
    await expect(harness.identity.verifySignup({ signup_id, code: right })).rejects.toMatchObject({ code: "too_many_attempts" });
  });

  it("refuses an expired code", async () => {
    const { signup_id } = await harness.identity.startSignup({ name: "Late", email: "late@venom.test" });
    await harness.owner`update signups set expires_at = clock_timestamp() - interval '1 second' where id = ${signup_id}`;
    await expect(
      harness.identity.verifySignup({ signup_id, code: harness.mailer.lastCodeFor("late@venom.test") }),
    ).rejects.toMatchObject({ code: "challenge_expired" });
  });

  it("will not take a secret word before the email is confirmed", async () => {
    const { signup_id } = await harness.identity.startSignup({ name: "Early", email: "early@venom.test" });
    const flow = await beginSecretWordRegistration("early bird singing");
    await expect(
      harness.identity.registerSecretWord({ signup_id, registration_request: flow.registrationRequest }),
    ).rejects.toMatchObject({ code: "email_not_verified" });
  });

  it("points an existing email to attaching instead, without saying so before the code is confirmed", async () => {
    await signUp(harness, "taken@venom.test", "first secret word");
    const started = await harness.identity.startSignup({ name: "Again", email: "TAKEN@venom.test" });
    expect(started.signup_id).toBeDefined();
    await expect(
      harness.identity.verifySignup({ signup_id: started.signup_id, code: harness.mailer.lastCodeFor("taken@venom.test") }),
    ).rejects.toMatchObject({ code: "account_exists" });
  });

  it("limits how many codes one email can ask for", async () => {
    const limited = await startIdentity({ signupsPerWindow: 2 });
    try {
      await limited.identity.startSignup({ name: "A", email: "busy@venom.test" });
      await limited.identity.startSignup({ name: "A", email: "busy@venom.test" });
      await expect(limited.identity.startSignup({ name: "A", email: "Busy@venom.test" })).rejects.toMatchObject({
        code: "too_many_attempts",
      });
    } finally {
      await limited.close();
    }
  });

  it("reports a mail outage clearly instead of pretending the code was sent", async () => {
    harness.mailer.failNext();
    await expect(harness.identity.startSignup({ name: "Offline", email: "offline@venom.test" })).rejects.toMatchObject({
      code: "mail_unavailable",
    });
  });

  it("rejects a damaged registration record", async () => {
    const { signup_id } = await harness.identity.startSignup({ name: "Bad", email: "bad@venom.test" });
    await harness.identity.verifySignup({ signup_id, code: harness.mailer.lastCodeFor("bad@venom.test") });
    await expect(
      harness.identity.finishSignup({ signup_id, registration_record: "AAAAAAAAAAAAAAAAAAAAAA", device: deviceInfo("x") }, uuidv7()),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
