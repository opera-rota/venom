import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function newDeviceToken(): string {
  return `vnm_${randomBytes(32).toString("base64url")}`;
}

export function newVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function codeDigest(challengeId: string, code: string): Buffer {
  return digest(`venom.code:${challengeId}:${code}`);
}

export function tokenDigest(token: string): Buffer {
  return digest(`venom.device:${token}`);
}

export function sameDigest(expected: Uint8Array, actual: Uint8Array): boolean {
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function decodeOpaque(message: string): Buffer {
  return Buffer.from(message, "base64url");
}

export function encodeOpaque(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
