import { GatewayEvent, MessageHistory, MessageText, SendMessageAccepted, type Message } from "@venom/contracts";
import { z } from "zod";
import type { ConnectionState, SendResult } from "../shared/bridge.ts";

export interface GatewayClientOptions {
  readonly gatewayUrl: string;
  readonly deviceId: string;
  readonly requestTimeoutMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
}

const ErrorBody = z.object({ message: z.string().optional(), error: z.string().optional() });

const unknownDeviceCode = 4404;

function decodeEvent(data: unknown): GatewayEvent | null {
  try {
    const event = GatewayEvent.safeParse(JSON.parse(String(data)));
    return event.success ? event.data : null;
  } catch {
    return null;
  }
}

export class GatewayClient {
  readonly #base: URL;
  readonly #deviceId: string;
  readonly #requestTimeoutMs: number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #eventListeners = new Set<(event: GatewayEvent) => void>();
  readonly #stateListeners = new Set<(state: ConnectionState) => void>();
  #state: ConnectionState = "connecting";
  #socket: WebSocket | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #running = false;

  constructor({ gatewayUrl, deviceId, requestTimeoutMs = 5_000, retryBaseMs = 500, retryMaxMs = 10_000 }: GatewayClientOptions) {
    this.#base = new URL(gatewayUrl);
    this.#deviceId = deviceId;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#retryBaseMs = retryBaseMs;
    this.#retryMaxMs = retryMaxMs;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#connect();
  }

  stop(): void {
    this.#running = false;
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#socket?.close(1000, "client stopping");
    this.#socket = null;
  }

  onEvent(listener: (event: GatewayEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  async history(limit = 200): Promise<Message[]> {
    const url = this.#url("/v1/messages");
    url.searchParams.set("device_id", this.#deviceId);
    url.searchParams.set("limit", String(limit));
    const response = await fetch(url, { signal: AbortSignal.timeout(this.#requestTimeoutMs) });
    if (!response.ok) {
      throw new Error(await this.#describeFailure(response));
    }
    return MessageHistory.parse(await response.json()).messages;
  }

  async send(text: unknown): Promise<SendResult> {
    const parsed = MessageText.safeParse(text);
    if (!parsed.success) {
      return { ok: false, reason: "Write something before sending." };
    }

    try {
      const response = await fetch(this.#url("/v1/messages"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_id: this.#deviceId, text: parsed.data }),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
      if (response.status !== 202) {
        return { ok: false, reason: await this.#describeFailure(response) };
      }
      return { ok: true, requestId: SendMessageAccepted.parse(await response.json()).request_id };
    } catch {
      return { ok: false, reason: "VENOM's gateway is not reachable. Your message was not sent." };
    }
  }

  #url(path: string): URL {
    return new URL(path, this.#base);
  }

  async #describeFailure(response: Response): Promise<string> {
    const body = ErrorBody.safeParse(await response.json().catch(() => ({})));
    return (body.success ? body.data.message : undefined) ?? `The gateway answered with status ${response.status}.`;
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
    const url = this.#url("/v1/live");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("device_id", this.#deviceId);

    const socket = new WebSocket(url);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#attempt = 0;
      this.#setState("online");
    });

    socket.addEventListener("message", ({ data }) => {
      const event = decodeEvent(data);
      if (event === null) {
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
    this.#setState("offline");
    if (this.#running && code !== unknownDeviceCode) {
      this.#scheduleReconnect();
    }
  }

  #scheduleReconnect(): void {
    const ceiling = Math.min(this.#retryMaxMs, this.#retryBaseMs * 2 ** this.#attempt);
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.#attempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      if (this.#running) {
        this.#connect();
      }
    }, delay);
  }
}
