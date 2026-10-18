import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attach, deviceInfo, proveSecretWord, signUp, startIdentity, type IdentityHarness } from "./support.ts";

const email = "owner@venom.test";
const secretWord = "green tiger mountain";

let harness: IdentityHarness;

beforeAll(async () => {
  harness = await startIdentity();
  await signUp(harness, email, secretWord);
});

afterAll(async () => {
  await harness?.close();
});

describe("attaching a device with email and secret word", () => {
  it("joins a second device to the same account and lists both", async () => {
    const second = await attach(harness, "Owner@Venom.test", secretWord);
    const devices = await harness.identity.devices(second.account.id);

    expect(devices.map((device) => device.name)).toEqual(["Work laptop", "Second laptop"]);
    expect(new Set(devices.map((device) => device.account_id))).toEqual(new Set([second.account.id]));
    expect(harness.mailer.sent.at(-1)?.subject).toContain("add a device");
  });

  it("refuses a wrong secret word on the device itself, before anything is sent back", async () => {
    const { proof } = await proveSecretWord(harness, email, "green tiger valley");
    expect(proof).toBeNull();
  });

  it("refuses a forged proof on the server and records the refusal", async () => {
    const { challenge } = await proveSecretWord(harness, email, "anything at all");
    await expect(
      harness.identity.proveAttach({ attach_id: challenge.attach_id, secret_word_proof: randomBytes(192).toString("base64url") }, uuidv7()),
    ).rejects.toMatchObject({ code: "secret_word_incorrect" });

    const [refused] = await harness.owner`
      select count(*)::int as total from audit_log where action = 'device.attach_refused' and subject_id = ${challenge.attach_id}
    `;
    expect(refused?.["total"]).toBe(1);
  });

  it("gives an unknown email the same kind of answer as a known one", async () => {
    const known = await proveSecretWord(harness, email, "wrong words here");
    const unknown = await proveSecretWord(harness, "nobody@venom.test", "wrong words here");

    expect(unknown.challenge.login_response.length).toBe(known.challenge.login_response.length);
    expect(unknown.proof).toBeNull();
  });

  it("lets each proof be used only once", async () => {
    const { challenge, proof } = await proveSecretWord(harness, email, secretWord);
    if (proof === null) {
      throw new Error("expected a proof");
    }
    await harness.identity.proveAttach({ attach_id: challenge.attach_id, secret_word_proof: proof }, uuidv7());
    await expect(
      harness.identity.proveAttach({ attach_id: challenge.attach_id, secret_word_proof: proof }, uuidv7()),
    ).rejects.toMatchObject({ code: "challenge_expired" });
  });

  it("still needs the emailed code after the right secret word", async () => {
    const { challenge, proof } = await proveSecretWord(harness, email, secretWord);
    if (proof === null) {
      throw new Error("expected a proof");
    }
    await harness.identity.proveAttach({ attach_id: challenge.attach_id, secret_word_proof: proof }, uuidv7());
    const right = harness.mailer.lastCodeFor(email);
    const wrong = right === "999999" ? "888888" : "999999";

    await expect(
      harness.identity.confirmAttach({ attach_id: challenge.attach_id, code: wrong, device: deviceInfo("Intruder") }, uuidv7()),
    ).rejects.toMatchObject({ code: "code_incorrect" });
    const joined = await harness.identity.confirmAttach({ attach_id: challenge.attach_id, code: right, device: deviceInfo("Third") }, uuidv7());
    expect(joined.device.name).toBe("Third");
  });

  it("locks attaching for an email after too many tries", async () => {
    const limited = await startIdentity({ attachesPerWindow: 3 });
    try {
      await signUp(limited, "guarded@venom.test", secretWord);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await proveSecretWord(limited, "guarded@venom.test", "guess number one")).proof).toBeNull();
      }
      await expect(proveSecretWord(limited, "guarded@venom.test", secretWord)).rejects.toMatchObject({ code: "too_many_attempts" });
    } finally {
      await limited.close();
    }
  });

  it("stops a device limit from being exceeded", async () => {
    const limited = await startIdentity({ devicesPerAccount: 1 });
    try {
      await signUp(limited, "single@venom.test", secretWord);
      await expect(attach(limited, "single@venom.test", secretWord)).rejects.toMatchObject({ code: "device_limit_reached" });
    } finally {
      await limited.close();
    }
  });
});

describe("device tokens and the registry", () => {
  it("authenticates with a token and stops the moment the device is removed", async () => {
    const extra = await attach(harness, email, secretWord, "Old phone");
    const ref = await harness.identity.authenticate(extra.device_token);
    expect(ref?.id).toBe(extra.device.id);

    const revoked = await harness.identity.revokeDevice({ id: extra.device.id, account_id: extra.account.id }, extra.device.id, uuidv7());
    expect(revoked.status).toBe("revoked");
    expect(await harness.identity.authenticate(extra.device_token)).toBeNull();
    expect((await harness.identity.devices(extra.account.id)).map((device) => device.id)).not.toContain(extra.device.id);
  });

  it("ignores malformed and unknown tokens", async () => {
    expect(await harness.identity.authenticate("nope")).toBeNull();
    expect(await harness.identity.authenticate(`vnm_${randomBytes(32).toString("base64url")}`)).toBeNull();
  });

  it("cannot remove a device that belongs to someone else", async () => {
    const mine = await signUp(harness, "mine@venom.test", secretWord);
    const theirs = await signUp(harness, "theirs@venom.test", secretWord);
    await expect(
      harness.identity.revokeDevice({ id: mine.device.id, account_id: mine.account.id }, theirs.device.id, uuidv7()),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await harness.identity.authenticate(theirs.device_token)).not.toBeNull();
  });

  it("tracks presence and reported capabilities", async () => {
    const session = await signUp(harness, "presence@venom.test", secretWord);
    const ref = { id: session.device.id, account_id: session.account.id };

    await harness.identity.markPresence(ref, true);
    expect((await harness.identity.session(ref)).device).toMatchObject({ status: "active", last_seen_at: expect.any(String) });

    const updated = await harness.identity.reportCapabilities(
      ref,
      { ...session.device.capabilities, notifications: true },
      uuidv7(),
    );
    expect(updated.capabilities.notifications).toBe(true);

    await harness.identity.markPresence(ref, false);
    expect((await harness.identity.session(ref)).device.status).toBe("offline");
  });

  it("does not let the app role rewrite a device credential", async () => {
    await expect(harness.app`update devices set credential_hash = null`).rejects.toMatchObject({ code: "42501" });
    await expect(harness.app`delete from account_secrets`).rejects.toMatchObject({ code: "42501" });
  });
});
