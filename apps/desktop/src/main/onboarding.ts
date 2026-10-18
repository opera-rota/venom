import {
  AttachChallenge,
  AttachProven,
  DeviceSession,
  Email,
  PersonName,
  SecretWord,
  SecretWordRegistrationResponse,
  SignupStarted,
  VerificationCode,
  type DeviceInfo,
} from "@venom/contracts";
import { beginSecretWordLogin, beginSecretWordRegistration } from "@venom/identity/client";
import type { Failure, StepResult } from "../shared/bridge.ts";
import type { Api } from "./api.ts";

export interface OnboardingOptions {
  readonly api: Api;
  readonly device: () => DeviceInfo;
  readonly complete: (session: DeviceSession) => Promise<void>;
}

const done: StepResult = { ok: true };

function invalid(reason: string): Failure {
  return { ok: false, code: "invalid_request", reason };
}

const startAgain: Failure = { ok: false, code: "challenge_expired", reason: "This step has expired. Please start again." };

export class Onboarding {
  readonly #api: Api;
  readonly #device: () => DeviceInfo;
  readonly #complete: (session: DeviceSession) => Promise<void>;
  #signupId: string | null = null;
  #attachId: string | null = null;

  constructor({ api, device, complete }: OnboardingOptions) {
    this.#api = api;
    this.#device = device;
    this.#complete = complete;
  }

  reset(): void {
    this.#signupId = null;
    this.#attachId = null;
  }

  async startSignup(name: unknown, email: unknown): Promise<StepResult> {
    const cleanName = PersonName.safeParse(typeof name === "string" ? name.trim() : name);
    const cleanEmail = Email.safeParse(typeof email === "string" ? email.trim() : email);
    if (!cleanName.success) {
      return invalid("Tell VENOM what to call you.");
    }
    if (!cleanEmail.success) {
      return invalid("That does not look like an email address.");
    }

    this.reset();
    const started = await this.#api.request("POST", "/v1/signup", {
      schema: SignupStarted,
      body: { name: cleanName.data, email: cleanEmail.data },
    });
    if (!started.ok) {
      return started;
    }
    this.#signupId = started.value.signup_id;
    return done;
  }

  async verifySignup(code: unknown): Promise<StepResult> {
    if (this.#signupId === null) {
      return startAgain;
    }
    const cleanCode = VerificationCode.safeParse(typeof code === "string" ? code.replace(/\s/g, "") : code);
    if (!cleanCode.success) {
      return invalid("The code is the 6 numbers in the email.");
    }
    const verified = await this.#api.request("POST", "/v1/signup/verify", { body: { signup_id: this.#signupId, code: cleanCode.data } });
    return verified.ok ? done : verified;
  }

  async chooseSecretWord(secretWord: unknown, repeated: unknown): Promise<StepResult> {
    if (this.#signupId === null) {
      return startAgain;
    }
    const word = SecretWord.safeParse(secretWord);
    if (!word.success) {
      return invalid("Choose a secret word or phrase of at least 8 characters.");
    }
    if (repeated !== secretWord) {
      return { ok: false, code: "secret_word_mismatch", reason: "The two secret words are different. Type the same one twice." };
    }

    const flow = await beginSecretWordRegistration(word.data);
    const response = await this.#api.request("POST", "/v1/signup/secret-word", {
      schema: SecretWordRegistrationResponse,
      body: { signup_id: this.#signupId, registration_request: flow.registrationRequest },
    });
    if (!response.ok) {
      return response;
    }

    const session = await this.#api.request("POST", "/v1/signup/finish", {
      schema: DeviceSession,
      body: {
        signup_id: this.#signupId,
        registration_record: flow.finish(response.value.registration_response),
        device: this.#device(),
      },
    });
    if (!session.ok) {
      return session;
    }

    this.reset();
    return this.#finish(session.value);
  }

  async startAttach(email: unknown, secretWord: unknown): Promise<StepResult> {
    const cleanEmail = Email.safeParse(typeof email === "string" ? email.trim() : email);
    const word = SecretWord.safeParse(secretWord);
    if (!cleanEmail.success) {
      return invalid("That does not look like an email address.");
    }
    if (!word.success) {
      return { ok: false, code: "secret_word_incorrect", reason: "That email and secret word do not match." };
    }

    this.reset();
    const flow = await beginSecretWordLogin(word.data);
    const challenge = await this.#api.request("POST", "/v1/attach", {
      schema: AttachChallenge,
      body: { email: cleanEmail.data, start_login_request: flow.startLoginRequest },
    });
    if (!challenge.ok) {
      return challenge;
    }

    const proof = flow.finish(challenge.value.login_response);
    if (proof === null) {
      return { ok: false, code: "secret_word_incorrect", reason: "That email and secret word do not match." };
    }

    const proven = await this.#api.request("POST", "/v1/attach/prove", {
      schema: AttachProven,
      body: { attach_id: challenge.value.attach_id, secret_word_proof: proof },
    });
    if (!proven.ok) {
      return proven;
    }
    this.#attachId = proven.value.attach_id;
    return done;
  }

  async confirmAttach(code: unknown): Promise<StepResult> {
    if (this.#attachId === null) {
      return startAgain;
    }
    const cleanCode = VerificationCode.safeParse(typeof code === "string" ? code.replace(/\s/g, "") : code);
    if (!cleanCode.success) {
      return invalid("The code is the 6 numbers in the email.");
    }

    const session = await this.#api.request("POST", "/v1/attach/confirm", {
      schema: DeviceSession,
      body: { attach_id: this.#attachId, code: cleanCode.data, device: this.#device() },
    });
    if (!session.ok) {
      return session;
    }

    this.reset();
    return this.#finish(session.value);
  }

  async #finish(session: DeviceSession): Promise<StepResult> {
    try {
      await this.#complete(session);
      return done;
    } catch (error) {
      return {
        ok: false,
        code: "internal",
        reason: error instanceof Error ? error.message : "VENOM could not finish signing in on this computer.",
      };
    }
  }
}
