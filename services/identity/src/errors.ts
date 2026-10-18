import type { ApiErrorCode } from "@venom/contracts";

export class IdentityError extends Error {
  override readonly name = "IdentityError";
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function attemptsLeft(left: number): string {
  return left === 1 ? "1 try left" : `${left} tries left`;
}

export const refuse = {
  expired: () => new IdentityError(410, "challenge_expired", "This step has expired. Please start again."),
  tooManyAttempts: () =>
    new IdentityError(429, "too_many_attempts", "Too many tries. Wait 15 minutes, then start again."),
  codeIncorrect: (left: number) =>
    new IdentityError(400, "code_incorrect", `That code is not right. ${attemptsLeft(left)}.`),
  emailNotVerified: () =>
    new IdentityError(403, "email_not_verified", "Confirm your email with the code before choosing a secret word."),
  accountExists: () =>
    new IdentityError(409, "account_exists", "This email already has a VENOM. Choose \"Attach this device\" instead."),
  secretWordIncorrect: () =>
    new IdentityError(401, "secret_word_incorrect", "That email and secret word do not match."),
  deviceLimit: (limit: number) =>
    new IdentityError(409, "device_limit_reached", `This VENOM already has ${limit} devices. Remove one before adding another.`),
  notFound: () => new IdentityError(404, "not_found", "That device is not part of your VENOM."),
  malformed: () => new IdentityError(400, "invalid_request", "The secure sign-in message was not valid."),
  mailUnavailable: () =>
    new IdentityError(503, "mail_unavailable", "VENOM could not send the email right now. Please try again in a moment."),
} as const;
