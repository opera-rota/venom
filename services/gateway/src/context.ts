import type { ConfirmationAnswered, ConfirmRequest, HowTo, LaterItem, MemoryForgotten, MemoryItem, PowerStatus, StopReceipt, Task } from "@venom/contracts";
import type { Kept, Store } from "@venom/db";
import type { Identity } from "@venom/identity";
import type { Memory } from "@venom/memory";
import type { Availability, Power } from "@venom/power";
import type { CommandSigner, Trust } from "@venom/safety";
import type { Goals, Tasks } from "@venom/tasks";
import type { Acting } from "./acting.ts";
import type { Brain } from "./brain.ts";
import type { LiveHub } from "./live-hub.ts";
import type { GoalLoop } from "./loop.ts";
import type { LiveRequests } from "./requests.ts";
import type { SaidKind, TaskRunner } from "./runner.ts";

export interface GatewayContext {
  readonly store: Store;
  readonly identity: Identity;
  readonly hub: LiveHub;
  readonly requests: LiveRequests;
  readonly brain: Brain;
  readonly power: Power;
  readonly memory: Memory;
  readonly tasks: Tasks;
  readonly goals: Goals;
  readonly loop: GoalLoop;
  readonly trust: Trust;
  readonly signer: CommandSigner;
  readonly runner: TaskRunner;
  readonly acting: Acting;
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
  broadcastKept(accountId: string, requestId: string, kept: Kept): void;
  broadcastLaterSeen(accountId: string, requestId: string, item: LaterItem): void;
  broadcastLaterRemoved(accountId: string, requestId: string, itemId: string): void;
  broadcastHowTo(accountId: string, requestId: string, howto: HowTo): void;
  broadcastHowToRemoved(accountId: string, requestId: string, howtoId: string): void;
  say(task: Task, kind: SaidKind, text: string, stepId: string | null): Promise<void>;
  availableEngines(): Promise<Availability>;
}

export const closeCodes = {
  unauthorized: 4401,
  revoked: 4403,
} as const;
