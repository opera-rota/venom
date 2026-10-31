import {
  GatewayEvent,
  type CommandFrame,
  type ConfirmationAnswered,
  type ConfirmRequest,
  type Device,
  type MemoryForgotten,
  type MemoryItem,
  type Message,
  type PowerStatus,
  type QuestionRef,
  type StopReceipt,
  type Task,
} from "@venom/contracts";
import type { LiveRequests } from "./requests.ts";

export interface LiveConnection {
  readonly deviceId: string;
  readonly accountId: string;
  readonly signed: boolean;
  send(frame: GatewayEvent | CommandFrame): void;
  close(code: number, reason: string): void;
}

export interface Attachment {
  readonly first: boolean;
  detach(): { readonly last: boolean };
}

export class LiveHub {
  readonly #byDevice = new Map<string, Set<LiveConnection>>();
  readonly #byAccount = new Map<string, Set<string>>();

  attach(connection: LiveConnection): Attachment {
    const connections = this.#byDevice.get(connection.deviceId) ?? new Set<LiveConnection>();
    const first = connections.size === 0;
    connections.add(connection);
    this.#byDevice.set(connection.deviceId, connections);

    const devices = this.#byAccount.get(connection.accountId) ?? new Set<string>();
    devices.add(connection.deviceId);
    this.#byAccount.set(connection.accountId, devices);

    let attached = true;
    return {
      first,
      detach: () => {
        if (!attached) {
          return { last: false };
        }
        attached = false;
        connections.delete(connection);
        if (connections.size > 0) {
          return { last: false };
        }
        this.#byDevice.delete(connection.deviceId);
        devices.delete(connection.deviceId);
        if (devices.size === 0) {
          this.#byAccount.delete(connection.accountId);
        }
        return { last: true };
      },
    };
  }

  publishToDevice(deviceId: string, event: GatewayEvent): void {
    for (const connection of this.#byDevice.get(deviceId) ?? []) {
      connection.send(event);
    }
  }

  publishToAccount(accountId: string, event: GatewayEvent): void {
    for (const deviceId of this.#byAccount.get(accountId) ?? []) {
      this.publishToDevice(deviceId, event);
    }
  }

  sendCommand(deviceId: string, frame: CommandFrame): number {
    let delivered = 0;
    for (const connection of this.#byDevice.get(deviceId) ?? []) {
      if (connection.signed) {
        connection.send(frame);
        delivered += 1;
      }
    }
    return delivered;
  }

  canAct(deviceId: string): boolean {
    return [...(this.#byDevice.get(deviceId) ?? [])].some((connection) => connection.signed);
  }

  devicesOf(accountId: string): readonly string[] {
    return [...(this.#byAccount.get(accountId) ?? [])];
  }

  disconnectDevice(deviceId: string, code: number, reason: string): void {
    for (const connection of [...(this.#byDevice.get(deviceId) ?? [])]) {
      connection.close(code, reason);
    }
  }

  get connectedDevices(): number {
    return this.#byDevice.size;
  }
}

function stamp(requestId: string, sequence: number) {
  return { request_id: requestId, sequence, emitted_at: new Date().toISOString() };
}

export function devicesEvent(requestId: string, devices: readonly Device[]): GatewayEvent {
  return GatewayEvent.parse({ type: "devices", ...stamp(requestId, 0), devices });
}

export function powerEvent(requestId: string, power: PowerStatus): GatewayEvent {
  return GatewayEvent.parse({ type: "power", ...stamp(requestId, 0), power });
}

export function memoryEvent(requestId: string, item: MemoryItem): GatewayEvent {
  return GatewayEvent.parse({ type: "memory", ...stamp(requestId, 0), item });
}

export function forgottenEvent(requestId: string, forgotten: MemoryForgotten): GatewayEvent {
  return GatewayEvent.parse({ type: "forgotten", ...stamp(requestId, 0), ...forgotten });
}

export function taskEvent(requestId: string, task: Task): GatewayEvent {
  return GatewayEvent.parse({ type: "task", ...stamp(requestId, 0), task });
}

export function confirmationEvent(requestId: string, request: ConfirmRequest, answered: ConfirmationAnswered | null): GatewayEvent {
  return GatewayEvent.parse({ type: "confirmation", ...stamp(requestId, 0), request, answered });
}

export function haltEvent(requestId: string, receipt: StopReceipt): GatewayEvent {
  return GatewayEvent.parse({ type: "halt", ...stamp(requestId, 0), ...receipt });
}

export class RequestTrace {
  readonly requestId: string;
  readonly #accountId: string;
  readonly #hub: LiveHub;
  readonly #requests: LiveRequests;
  #sequence = 0;

  constructor(hub: LiveHub, requests: LiveRequests, accountId: string, requestId: string) {
    this.#hub = hub;
    this.#requests = requests;
    this.#accountId = accountId;
    this.requestId = requestId;
  }

  accepted(question: QuestionRef): void {
    this.#requests.start(this.#accountId, this.requestId, question);
    this.#emit({ type: "request", ...stamp(this.requestId, this.#sequence++), state: "accepted", detail: null, question });
  }

  completed(): void {
    this.#emit({ type: "request", ...stamp(this.requestId, this.#sequence++), state: "completed", detail: null, question: null });
  }

  failed(detail: string): void {
    this.#emit({ type: "request", ...stamp(this.requestId, this.#sequence++), state: "failed", detail, question: null });
  }

  answer(delta: string): void {
    this.#emit({ type: "answer", ...stamp(this.requestId, this.#sequence++), delta });
  }

  message(message: Message): void {
    this.#emit({ type: "message", ...stamp(this.requestId, this.#sequence++), message });
  }

  #emit(event: GatewayEvent): void {
    const parsed = GatewayEvent.parse(event);
    this.#requests.record(this.#accountId, parsed);
    this.#hub.publishToAccount(this.#accountId, parsed);
  }
}
