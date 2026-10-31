import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { CommandPayload, PublicKey, safetyLimits, SignedCommand } from "@venom/contracts";

export interface KeyPair {
  readonly privateKey: string;
  readonly publicKey: string;
}

export type Refusal = "unsigned" | "wrong_signature" | "unreadable" | "not_for_this_device" | "expired" | "repeated";

export type Checked =
  | { readonly ok: true; readonly payload: CommandPayload }
  | { readonly ok: false; readonly refusal: Refusal; readonly commandId: string | null };

export const refusalWords: Record<Refusal, string> = {
  unsigned: "The command was not signed, so this device refused it.",
  wrong_signature: "The command's signature did not match VENOM's key, so this device refused it.",
  unreadable: "The command could not be read, so this device refused it.",
  not_for_this_device: "The command was meant for another device, so this device refused it.",
  expired: "The command arrived too late, so this device refused it.",
  repeated: "The command was already used once, so this device refused it.",
};

function privateKeyObject({ privateKey, publicKey }: KeyPair): KeyObject {
  return createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: privateKey, x: publicKey }, format: "jwk" });
}

function publicKeyObject(publicKey: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
}

export function newKeyPair(): KeyPair {
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  if (jwk.d === undefined || jwk.x === undefined) {
    throw new Error("Could not create a device key");
  }
  return { privateKey: jwk.d, publicKey: jwk.x };
}

export function isKeyPair(pair: KeyPair): boolean {
  try {
    const derived = createPublicKey(privateKeyObject(pair)).export({ format: "jwk" }).x;
    return PublicKey.safeParse(pair.publicKey).success && derived === pair.publicKey;
  } catch {
    return false;
  }
}

export function signText(pair: KeyPair, text: string): string {
  return sign(null, Buffer.from(text, "utf8"), privateKeyObject(pair)).toString("base64url");
}

export function verifyText(publicKey: string, text: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(text, "utf8"), publicKeyObject(publicKey), Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

export function liveChallengeText(deviceId: string, challengeId: string, nonce: string): string {
  return `venom-live-v1\n${deviceId}\n${challengeId}\n${nonce}`;
}

export function commandText(payload: string): string {
  return `venom-command-v1\n${payload}`;
}

function readPayload(text: string): CommandPayload | null {
  try {
    const parsed = CommandPayload.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class CommandGuard {
  readonly #serverKey: string;
  readonly #deviceId: string;
  readonly #now: () => number;
  readonly #seen = new Map<string, number>();

  constructor(serverKey: string, deviceId: string, now: () => number = Date.now) {
    this.#serverKey = serverKey;
    this.#deviceId = deviceId;
    this.#now = now;
  }

  check(command: unknown): Checked {
    const signed = SignedCommand.safeParse(command);
    if (!signed.success) {
      return { ok: false, refusal: "unsigned", commandId: null };
    }
    const { payload: text, signature } = signed.data;
    if (!verifyText(this.#serverKey, commandText(text), signature)) {
      return { ok: false, refusal: "wrong_signature", commandId: null };
    }
    const payload = readPayload(text);
    if (payload === null) {
      return { ok: false, refusal: "unreadable", commandId: null };
    }
    const refused = (refusal: Refusal): Checked => ({ ok: false, refusal, commandId: payload.command_id });
    if (payload.device_id !== this.#deviceId) {
      return refused("not_for_this_device");
    }
    const now = this.#now();
    const skew = safetyLimits.clockSkewSeconds * 1000;
    const issued = Date.parse(payload.issued_at);
    const expires = Date.parse(payload.expires_at);
    if (issued > now + skew || expires <= now - skew || expires - issued > safetyLimits.commandLifetimeSeconds * 1000) {
      return refused("expired");
    }
    this.#forgetOld(now - skew);
    if (this.#seen.has(payload.command_id)) {
      return refused("repeated");
    }
    this.#seen.set(payload.command_id, expires);
    return { ok: true, payload };
  }

  #forgetOld(before: number): void {
    for (const [commandId, expires] of this.#seen) {
      if (expires <= before) {
        this.#seen.delete(commandId);
      }
    }
  }
}
