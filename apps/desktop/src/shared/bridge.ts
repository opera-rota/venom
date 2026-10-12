import type { GatewayEvent, Message } from "@venom/contracts";

export type ConnectionState = "connecting" | "online" | "offline";

export type SendResult = { readonly ok: true; readonly requestId: string } | { readonly ok: false; readonly reason: string };

export interface VenomBridge {
  history(): Promise<Message[]>;
  send(text: string): Promise<SendResult>;
  connection(): Promise<ConnectionState>;
  onEvent(listener: (event: GatewayEvent) => void): () => void;
  onConnection(listener: (state: ConnectionState) => void): () => void;
}

export const channels = {
  history: "venom:history",
  send: "venom:send",
  connection: "venom:connection",
  event: "venom:event",
  connectionChanged: "venom:connection-changed",
} as const;
