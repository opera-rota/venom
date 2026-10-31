import type { ConfirmationAnswered, ConfirmRequest, MemoryForgotten, MemoryItem, PowerStatus, StopReceipt, Task } from "@venom/contracts";
import type { Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { Memory } from "@venom/memory";
import type { Availability, Power } from "@venom/power";
import type { CommandSigner, Trust } from "@venom/safety";
import type { Tasks } from "@venom/tasks";
import type { Brain } from "./brain.ts";
import type { LiveHub } from "./live-hub.ts";
import type { LiveRequests } from "./requests.ts";
import type { TaskRunner } from "./runner.ts";

export interface GatewayContext {
  readonly store: Store;
  readonly identity: Identity;
  readonly hub: LiveHub;
  readonly requests: LiveRequests;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly tasks: Tasks;
  readonly trust: Trust;
  readonly signer: CommandSigner;
  readonly runner: TaskRunner;
  readonly stopping: AbortSignal;
  readonly heartbeatMs: number;
  track(work: Promise<unknown>): void;
  isClosing(): boolean;
  broadcastDevices(accountId: string, requestId: string): Promise<void>;
  broadcastPower(accountId: string, requestId: string, status: PowerStatus): void;
  broadcastMemory(accountId: string, requestId: string, item: MemoryItem): void;
  broadcastForgotten(accountId: string, requestId: string, forgotten: MemoryForgotten): void;
  broadcastTask(accountId: string, requestId: string, task: Task): void;
  broadcastConfirmation(accountId: string, requestId: string, request: ConfirmRequest, answered: ConfirmationAnswered | null): void;
  broadcastHalt(accountId: string, requestId: string, receipt: StopReceipt): void;
  availableEngines(): Promise<Availability>;
}

export const closeCodes = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
