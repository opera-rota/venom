import { liveProtocols } from "@venom/contracts";
import type { LiveLink, LiveProof } from "@desktop/main/gateway-client.ts";
import { signWithPhoneKey } from "./phone-keys.ts";

export function protocolsFor(token: string, proof: LiveProof | null): string[] {
  const signed = proof === null ? [] : [`${liveProtocols.challenge}.${proof.challengeId}`, `${liveProtocols.signature}.${proof.signature}`];
  return [liveProtocols.link, `${liveProtocols.bearer}.${token}`, ...signed];
}

export const phoneLink: LiveLink = {
  sign: (trust, text) => signWithPhoneKey(trust.pair, text),
  open: (url, token, proof) => new WebSocket(url, protocolsFor(token, proof)),
};
