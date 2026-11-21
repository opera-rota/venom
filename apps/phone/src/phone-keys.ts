import { ed25519 } from "@noble/curves/ed25519.js";
import type { KeyPair } from "@venom/safety/device";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
}

export function newPhoneKeys(): KeyPair {
  const { secretKey, publicKey } = ed25519.keygen();
  return { privateKey: toBase64Url(secretKey), publicKey: toBase64Url(publicKey) };
}

export function signWithPhoneKey(pair: KeyPair, text: string): string {
  return toBase64Url(ed25519.sign(new TextEncoder().encode(text), fromBase64Url(pair.privateKey)));
}
