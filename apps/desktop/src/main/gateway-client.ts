import {
  DeviceList,
  EngineId,
  EngineList,
  GatewayEvent,
  Id,
  MessageHistory,
  MessageText,
  PowerStatus,
  SendMessageAccepted,
  type Capabilities,
  type Message,
} from "@venom/contracts";
import type { ConnectionState, DevicesResult, EnginesResult, PowerResult, SendResult, StepResult } from "../shared/bridge.ts";
import type { Api } from "./api.ts";

export interface GatewayClientOptions {
  readonly api: Api;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
}

export type Revocation = "removed" | "unauthorized";

const closeReasons: ReadonlyMap<number, Revocation> = new Map([
  [4401, "unauthorized"],
  [4403, "removed"],
]);

function decodeEvent(data: unknown): GatewayEvent | null {
  try {
    const event = GatewayEvent.safeParse(JSON.parse(String(data)));
    return event.success ? event.data : null;
  } catch {
    return null;
  }
}

export class GatewayClient {
  readonly #api: Api;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #eventListeners = new Set<(event: GatewayEvent) => void>();
  readonly #stateListeners = new Set<(state: ConnectionState) => void>();
  readonly #revokedListeners = new Set<(reason: Revocation) => void>();
  #state: ConnectionState = "offline";
  #token: string | null = null;
  #socket: WebSocket | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;

  constructor({ api, retryBaseMs = 500, retryMaxMs = 10_000 }: GatewayClientOptions) {
    this.#api = api;
    this.#retryBaseMs = retryBaseMs;
    this.#retryMaxMs = retryMaxMs;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get running(): boolean {
    return this.#token !== null;
  }

  start(token: string): void {
    if (this.#token === token) {
      return;
    }
    this.stop();
    this.#token = token;
    this.#attempt = 0;
    this.#setState("connecting");
    this.#connect();
  }

  stop(): void {
    this.#token = null;
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    const socket = this.#socket;
    this.#socket = null;
    socket?.close(1000, "client stopping");
    this.#setState("offline");
  }

  onEvent(listener: (event: GatewayEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  onRevoked(listener: (reason: Revocation) => void): () => void {
    this.#revokedListeners.add(listener);
    return () => this.#revokedListeners.delete(listener);
  }

  async history(limit = 200): Promise<Message[]> {
    const result = await this.#api.request("GET", `/v1/messages?limit=${limit}`, { schema: MessageHistory, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      throw new Error(result.reason);
    }
    return result.value.messages;
  }

  async send(text: unknown): Promise<SendResult> {
    const parsed = MessageText.safeParse(text);
    if (!parsed.success) {
      return { ok: false, code: "invalid_request", reason: "Write something before sending." };
    }
    const result = await this.#api.request("POST", "/v1/messages", {
      schema: SendMessageAccepted,
      body: { text: parsed.data },
      token: this.#token,
    });
    if (!result.ok) {
      this.#watch(result.code);
      return result.code === "network" ? { ...result, reason: "VENOM's gateway is not reachable. Your message was not sent." } : result;
    }
    return { ok: true, requestId: result.value.request_id };
  }

  async retry(requestId: unknown): Promise<SendResult> {
    const parsed = Id.safeParse(requestId);
    if (!parsed.success) {
      return { ok: false, code: "invalid_request", reason: "There is no answer to try again." };
    }
    const result = await this.#api.request("POST", "/v1/messages/retry", {
      schema: SendMessageAccepted,
      body: { request_id: parsed.data },
      token: this.#token,
    });
    if (!result.ok) {
      this.#watch(result.code);
      return result.code === "network" ? { ...result, reason: "VENOM's gateway is not reachable. Try again in a moment." } : result;
    }
    return { ok: true, requestId: result.value.request_id };
  }

  async devices(): Promise<DevicesResult> {
    const result = await this.#api.request("GET", "/v1/devices", { schema: DeviceList, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true, list: result.value };
  }

  async removeDevice(deviceId: string): Promise<StepResult> {
    const result = await this.#api.request("DELETE", `/v1/devices/${encodeURIComponent(deviceId)}`, { token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
    }
    return result.ok ? { ok: true } : result;
  }

  async engines(): Promise<EnginesResult> {
    const result = await this.#api.request("GET", "/v1/engines", { schema: EngineList, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true, list: result.value };
  }

  async power(): Promise<PowerResult> {
    const result = await this.#api.request("GET", "/v1/power", { schema: PowerStatus, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true, power: result.value };
  }

  async chooseEngine(engine: unknown): Promise<PowerResult> {
    const parsed = EngineId.safeParse(engine);
    if (!parsed.success) {
      return { ok: false, code: "invalid_request", reason: "That engine does not exist." };
    }
    const result = await this.#api.request("PUT", "/v1/engines/current", {
      schema: PowerStatus,
      body: { engine: parsed.data },
      token: this.#token,
    });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true, power: result.value };
  }

  async reportCapabilities(deviceId: string, capabilities: Capabilities): Promise<StepResult> {
    const result = await this.#api.request("PUT", "/v1/devices/current/capabilities", {
      body: { device_id: deviceId, capabilities },
      token: this.#token,
    });
    if (!result.ok) {
      this.#watch(result.code);
    }
    return result.ok ? { ok: true } : result;
  }

  #watch(code: string): void {
    if (code === "unauthorized") {
      this.#revoke("unauthorized");
    }
  }

  #revoke(reason: Revocation): void {
    if (this.#token === null) {
      return;
    }
    this.stop();
    for (const listener of this.#revokedListeners) {
      listener(reason);
    }
  }

  #setState(state: ConnectionState): void {
    if (this.#state === state) {
      return;
    }
    this.#state = state;
    for (const listener of this.#stateListeners) {
      listener(state);
    }
  }

  #connect(): void {
    const token = this.#token;
    if (token === null) {
      return;
    }
    const url = this.#api.url("/v1/live");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    this.#socket = socket;

    socket.addEventListener("open", () => {
      if (this.#socket === socket) {
        this.#attempt = 0;
        this.#setState("online");
      }
    });

    socket.addEventListener("message", ({ data }) => {
      const event = decodeEvent(data);
      if (event === null || this.#socket !== socket) {
        return;
      }
      for (const listener of this.#eventListeners) {
        listener(event);
      }
    });

    socket.addEventListener("close", ({ code }) => this.#dropped(socket, code));
    socket.addEventListener("error", () => this.#dropped(socket, null));
  }

  #dropped(socket: WebSocket, code: number | null): void {
    if (this.#socket !== socket) {
      return;
    }
    this.#socket = null;
    if (socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
    const revocation = code === null ? undefined : closeReasons.get(code);
    if (revocation !== undefined) {
      this.#revoke(revocation);
      return;
    }
    this.#setState("offline");
    if (this.#token !== null) {
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    const ceiling = Math.min(this.#retryMaxMs, this.#retryBaseMs * 2 ** this.#attempt);
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.#attempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connect();
    }, delay);
  }
}
