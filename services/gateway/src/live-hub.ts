import { GatewayEvent, type Device, type MemoryForgotten, type MemoryItem, type Message, type PowerStatus, type RequestState } from "@venom/contracts";

export interface LiveConnection {
  readonly deviceId: string;
  readonly accountId: string;
  send(event: GatewayEvent): void;
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

export class RequestTrace {
  readonly requestId: string;
  readonly #deviceId: string;
  readonly #hub: LiveHub;
  #sequence = 0;

  constructor(hub: LiveHub, deviceId: string, requestId: string) {
    this.#hub = hub;
    this.#deviceId = deviceId;
    this.requestId = requestId;
  }

  state(state: RequestState, detail: string | null = null): void {
    this.#emit({ type: "request", ...stamp(this.requestId, this.#sequence++), state, detail });
  }

  answer(delta: string): void {
    this.#emit({ type: "answer", ...stamp(this.requestId, this.#sequence++), delta });
  }

  message(message: Message): void {
    this.#emit({ type: "message", ...stamp(this.requestId, this.#sequence++), message });
  }

  #emit(event: GatewayEvent): void {
    this.#hub.publishToDevice(this.#deviceId, GatewayEvent.parse(event));
  }
}
