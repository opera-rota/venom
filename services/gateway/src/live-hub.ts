import { GatewayEvent, type Message, type RequestState } from "@venom/contracts";

export type Listener = (event: GatewayEvent) => void;

export class LiveHub {
  readonly #listeners = new Map<string, Set<Listener>>();

  subscribe(deviceId: string, listener: Listener): () => void {
    const listeners = this.#listeners.get(deviceId) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(deviceId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(deviceId);
      }
    };
  }

  publish(deviceId: string, event: GatewayEvent): void {
    for (const listener of this.#listeners.get(deviceId) ?? []) {
      listener(event);
    }
  }

  get connectedDevices(): number {
    return this.#listeners.size;
  }
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
    this.#emit({ type: "request", ...this.#stamp(), state, detail });
  }

  message(message: Message): void {
    this.#emit({ type: "message", ...this.#stamp(), message });
  }

  #stamp() {
    return {
      request_id: this.requestId,
      sequence: this.#sequence++,
      emitted_at: new Date().toISOString(),
    };
  }

  #emit(event: GatewayEvent): void {
    this.#hub.publish(this.#deviceId, GatewayEvent.parse(event));
  }
}
