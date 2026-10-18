import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, createBackend, expectOk, onboardingFor, type Backend } from "./support.ts";

const email = "ninette@venom.test";
const secretWord = "blue horse river";

let backend: Backend;

beforeAll(async () => {
  backend = await createBackend();
  await backend.start();
});

afterAll(async () => {
  await backend?.destroy();
});

describe("onboarding in the computer symbiote", () => {
  it("creates an account through every screen and hands back a signed-in device", async () => {
    const session = await createAccount(backend, email, secretWord);
    expect(session.account.email).toBe(email);
    expect(session.device.name).toBe("Work laptop");
  });

  it("attaches a second device to the same account with email, secret word and code", async () => {
    const { onboarding, sessions } = onboardingFor(backend.url(), "Second profile");
    await expectOk(onboarding.startAttach(` ${email} `, secretWord));
    await expectOk(onboarding.confirmAttach(backend.mailer.lastCodeFor(email)));
    expect(sessions[0]?.device.name).toBe("Second profile");
    expect(sessions[0]?.account.email).toBe(email);
  });

  it("refuses the wrong secret word without asking for a code", async () => {
    const sent = backend.mailer.sent.length;
    const { onboarding } = onboardingFor(backend.url(), "Intruder");
    expect(await onboarding.startAttach(email, "blue horse ocean")).toMatchObject({ ok: false, code: "secret_word_incorrect" });
    expect(backend.mailer.sent.length).toBe(sent);
    expect(await onboarding.confirmAttach("123456")).toMatchObject({ ok: false, code: "challenge_expired" });
  });

  it("checks the details on the device before anything is sent", async () => {
    const { onboarding } = onboardingFor(backend.url(), "Checker");
    expect(await onboarding.startSignup("  ", email)).toMatchObject({ ok: false, code: "invalid_request" });
    expect(await onboarding.startSignup("Ninette", "not an email")).toMatchObject({ ok: false, code: "invalid_request" });
    expect(await onboarding.verifySignup("123456")).toMatchObject({ ok: false, code: "challenge_expired" });

    await expectOk(onboarding.startSignup("Second", "second@venom.test"));
    expect(await onboarding.verifySignup("12")).toMatchObject({ ok: false, code: "invalid_request" });
    await expectOk(onboarding.verifySignup(backend.mailer.lastCodeFor("second@venom.test")));
    expect(await onboarding.chooseSecretWord("short", "short")).toMatchObject({ ok: false, code: "invalid_request" });
    expect(await onboarding.chooseSecretWord("long enough word", "long enough ward")).toMatchObject({ ok: false, code: "secret_word_mismatch" });
  });

  it("explains that an existing email should attach instead", async () => {
    const { onboarding } = onboardingFor(backend.url(), "Again");
    await expectOk(onboarding.startSignup("Again", email));
    expect(await onboarding.verifySignup(backend.mailer.lastCodeFor(email))).toMatchObject({
      ok: false,
      code: "account_exists",
      reason: expect.stringContaining("Attach this device"),
    });
  });

  it("says plainly when the gateway is down", async () => {
    const { onboarding } = onboardingFor("http://127.0.0.1:9", "Offline");
    expect(await onboarding.startSignup("Ninette", "down@venom.test")).toMatchObject({ ok: false, code: "network" });
  });
});
