import type { PowerStatus } from "@venom/contracts";
import type { Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { Availability, Power } from "@venom/power";
import type { Brain } from "./brain.ts";
import type { LiveHub } from "./live-hub.ts";

export interface GatewayContext {
  readonly store: Store;
  readonly identity: Identity;
  readonly hub: LiveHub;
  readonly brain: Brain;
  readonly power: Power;
  readonly stopping: AbortSignal;
  readonly heartbeatMs: number;
  track(work: Promise<unknown>): void;
  isClosing(): boolean;
  broadcastDevices(accountId: string, requestId: string): Promise<void>;
  broadcastPower(accountId: string, requestId: string, status: PowerStatus): void;
  availableEngines(): Promise<Availability>;
}

export const closeCodes = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
