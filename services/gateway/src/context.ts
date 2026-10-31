import type { MemoryForgotten, MemoryItem, PowerStatus } from "@venom/contracts";
import type { Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { Memory } from "@venom/memory";
import type { Availability, Power } from "@venom/power";
import type { Brain } from "./brain.ts";
import type { LiveHub } from "./live-hub.ts";
import type { LiveRequests } from "./requests.ts";

export interface GatewayContext {
  readonly store: Store;
  readonly identity: Identity;
  readonly hub: LiveHub;
  readonly requests: LiveRequests;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly stopping: AbortSignal;
  readonly heartbeatMs: number;
  track(work: Promise<unknown>): void;
  isClosing(): boolean;
  broadcastDevices(accountId: string, requestId: string): Promise<void>;
  broadcastPower(accountId: string, requestId: string, status: PowerStatus): void;
  broadcastMemory(accountId: string, requestId: string, item: MemoryItem): void;
  broadcastForgotten(accountId: string, requestId: string, forgotten: MemoryForgotten): void;
  availableEngines(): Promise<Availability>;
}

export const closeCodes = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
