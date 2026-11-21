import { signText } from "@venom/safety/device";
import type { LiveLink } from "./gateway-client.ts";

export const computerLink: LiveLink = {
  sign: (trust, text) => signText(trust.pair, text),
  open: (url, token, proof) =>
    new WebSocket(url, {
      headers: {
        authorization: `Bearer ${token}`,
        ...(proof === null ? {} : { "x-venom-challenge": proof.challengeId, "x-venom-signature": proof.signature }),
      },
    }),
};
