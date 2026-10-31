import { z } from "zod";
import { Email, Id, Timestamp } from "./primitives.ts";
import { DeviceInfo } from "./messages.ts";
import { Account, Device } from "./records.ts";
import { contracts } from "./registry.ts";

export const PersonName = z
  .string()
  .min(1)
  .max(120)
  .regex(/\S/)
  .register(contracts, { id: "PersonName" });

export const SecretWord = z
  .string()
  .min(8)
  .max(128)
  .regex(/\S/)
  .register(contracts, { id: "SecretWord" });

export const VerificationCode = z
  .string()
  .regex(/^\d{6}$/)
  .register(contracts, { id: "VerificationCode" });

export const OpaqueMessage = z
  .string()
  .min(16)
  .max(8192)
  .regex(/^[A-Za-z0-9_-]+$/)
  .register(contracts, { id: "OpaqueMessage" });

export const secretWordKeyStretching = "memory-constrained";

export const DeviceToken = z
  .string()
  .regex(/^vnm_[A-Za-z0-9_-]{43}$/)
  .register(contracts, { id: "DeviceToken" });

export const SignupStart = z
  .strictObject({
    name: PersonName,
    email: Email,
  })
  .register(contracts, { id: "SignupStart" });

export const SignupStarted = z
  .strictObject({
    signup_id: Id,
    expires_at: Timestamp,
  })
  .register(contracts, { id: "SignupStarted" });

export const SignupVerify = z
  .strictObject({
    signup_id: Id,
    code: VerificationCode,
  })
  .register(contracts, { id: "SignupVerify" });

export const SecretWordRegistration = z
  .strictObject({
    signup_id: Id,
    registration_request: OpaqueMessage,
  })
  .register(contracts, { id: "SecretWordRegistration" });

export const SecretWordRegistrationResponse = z
  .strictObject({
    registration_response: OpaqueMessage,
  })
  .register(contracts, { id: "SecretWordRegistrationResponse" });

export const SignupFinish = z
  .strictObject({
    signup_id: Id,
    registration_record: OpaqueMessage,
    device: DeviceInfo,
  })
  .register(contracts, { id: "SignupFinish" });

export const AttachStart = z
  .strictObject({
    email: Email,
    start_login_request: OpaqueMessage,
  })
  .register(contracts, { id: "AttachStart" });

export const AttachChallenge = z
  .strictObject({
    attach_id: Id,
    login_response: OpaqueMessage,
    expires_at: Timestamp,
  })
  .register(contracts, { id: "AttachChallenge" });

export const AttachProve = z
  .strictObject({
    attach_id: Id,
    secret_word_proof: OpaqueMessage,
  })
  .register(contracts, { id: "AttachProve" });

export const AttachProven = z
  .strictObject({
    attach_id: Id,
    expires_at: Timestamp,
  })
  .register(contracts, { id: "AttachProven" });

export const AttachConfirm = z
  .strictObject({
    attach_id: Id,
    code: VerificationCode,
    device: DeviceInfo,
  })
  .register(contracts, { id: "AttachConfirm" });

export const Session = z
  .strictObject({
    account: Account,
    device: Device,
  })
  .register(contracts, { id: "Session" });

export const DeviceSession = z
  .strictObject({
    account: Account,
    device: Device,
    device_token: DeviceToken,
  })
  .register(contracts, { id: "DeviceSession" });

export const DeviceList = z
  .strictObject({
    current_device_id: Id,
    devices: z.array(Device),
  })
  .register(contracts, { id: "DeviceList" });

export const ApiErrorCode = z
  .enum([
    "invalid_request",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "code_incorrect",
    "challenge_expired",
    "too_many_attempts",
    "secret_word_incorrect",
    "email_not_verified",
    "account_exists",
    "device_limit_reached",
    "mail_unavailable",
    "out_of_power",
    "memory_full",
    "internal",
  ])
  .register(contracts, { id: "ApiErrorCode" });

export const ApiIssue = z
  .strictObject({
    path: z.string(),
    message: z.string(),
  })
  .register(contracts, { id: "ApiIssue" });

export const ApiError = z
  .strictObject({
    error: ApiErrorCode,
    message: z.string().min(1),
    issues: z.array(ApiIssue).optional(),
  })
  .register(contracts, { id: "ApiError" });

export type PersonName = z.infer<typeof PersonName>;
export type SecretWord = z.infer<typeof SecretWord>;
export type VerificationCode = z.infer<typeof VerificationCode>;
export type OpaqueMessage = z.infer<typeof OpaqueMessage>;
export type DeviceToken = z.infer<typeof DeviceToken>;
export type SignupStart = z.infer<typeof SignupStart>;
export type SignupStarted = z.infer<typeof SignupStarted>;
export type SignupVerify = z.infer<typeof SignupVerify>;
export type SecretWordRegistration = z.infer<typeof SecretWordRegistration>;
export type SecretWordRegistrationResponse = z.infer<typeof SecretWordRegistrationResponse>;
export type SignupFinish = z.infer<typeof SignupFinish>;
export type AttachStart = z.infer<typeof AttachStart>;
export type AttachChallenge = z.infer<typeof AttachChallenge>;
export type AttachProve = z.infer<typeof AttachProve>;
export type AttachProven = z.infer<typeof AttachProven>;
export type AttachConfirm = z.infer<typeof AttachConfirm>;
export type Session = z.infer<typeof Session>;
export type DeviceSession = z.infer<typeof DeviceSession>;
export type DeviceList = z.infer<typeof DeviceList>;
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;
export type ApiIssue = z.infer<typeof ApiIssue>;
export type ApiError = z.infer<typeof ApiError>;
