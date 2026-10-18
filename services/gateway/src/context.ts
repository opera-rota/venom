import type { Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { LiveHub } from "./live-hub.ts";

export interface GatewayContext {
  readonly store: Store;
  readonly identity: Identity;
  readonly hub: LiveHub;
  readonly heartbeatMs: number;
  track(work: Promise<unknown>): void;
  isClosing(): boolean;
  broadcastDevices(accountId: string, requestId: string): Promise<void>;
}

export const closeCodes = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
