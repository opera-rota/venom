import {
  CommandFrame,
  ConfirmationAnswered,
  DeviceList,
  EngineId,
  EngineList,
  GatewayEvent,
  Id,
  LiveChallenge,
  MemoryDraft,
  MemoryForgotten,
  MemoryItem,
  MemoryList,
  MessageHistory,
  MessageText,
  PowerStatus,
  SafetySettings,
  SendMessageAccepted,
  StopReceipt,
  Task,
  TaskControl,
  TaskList,
  type Capabilities,
  type CommandReport,
  type ConfirmDecision,
  type ConfirmationStrictness,
  type DrillKind,
} from "@venom/contracts";
import { liveChallengeText, signText } from "@venom/safety/device";
import type {
  AnswerResult,
  ConnectionState,
  DevicesResult,
  EnginesResult,
  MemoryItemResult,
  MemoryResult,
  PowerResult,
  SafetyResult,
  SendResult,
  StepResult,
  TaskResult,
  TasksResult,
  TaskStopResult,
} from "../shared/bridge.ts";
import type { Api, Result } from "./api.ts";
import type { DeviceTrust } from "./session-manager.ts";

export interface GatewayClientOptions {
  readonly api: Api;
  readonly trust?: () => Promise<DeviceTrust | null>;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
}

export type Revocation = "removed" | "unauthorized";

export type HaltResult = { readonly ok: true; readonly receipt: StopReceipt } | Exclude<Result<never>, { ok: true }>;

const closeReasons: ReadonlyMap<number, Revocation> = new Map([
  [4401, "unauthorized"],
  [4403, "removed"],
]);

const unreadableDraft = "Write what VENOM should remember, in 500 characters or fewer.";

type Frame = { readonly kind: "event"; readonly event: GatewayEvent } | { readonly kind: "command"; readonly frame: CommandFrame };

function decodeFrame(data: unknown): Frame | null {
  try {
    const raw: unknown = JSON.parse(String(data));
    const command = CommandFrame.safeParse(raw);
    if (command.success) {
      return { kind: "command", frame: command.data };
    }
    const event = GatewayEvent.safeParse(raw);
    return event.success ? { kind: "event", event: event.data } : null;
  } catch {
    return null;
  }
}

export class GatewayClient {
  readonly #api: Api;
  readonly #trust: () => Promise<DeviceTrust | null>;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #eventListeners = new Set<(event: GatewayEvent) => void>();
  readonly #commandListeners = new Set<(frame: CommandFrame) => void>();
  readonly #stateListeners = new Set<(state: ConnectionState) => void>();
  readonly #revokedListeners = new Set<(reason: Revocation) => void>();
  #state: ConnectionState = "offline";
  #token: string | null = null;
  #socket: WebSocket | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #generation = 0;

  constructor({ api, trust = async () => null, retryBaseMs = 500, retryMaxMs = 10_000 }: GatewayClientOptions) {
    this.#api = api;
    this.#trust = trust;
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
    this.#generation += 1;
    this.#token = null;
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    const socket = this.#socket;
    this.#socket = null;
    if (socket?.readyState === WebSocket.CONNECTING) {
      socket.addEventListener("open", () => socket.close(1000, "client stopping"), { once: true });
    } else {
      socket?.close(1000, "client stopping");
    }
    this.#setState("offline");
  }

  onEvent(listener: (event: GatewayEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onCommand(listener: (frame: CommandFrame) => void): () => void {
    this.#commandListeners.add(listener);
    return () => this.#commandListeners.delete(listener);
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  onRevoked(listener: (reason: Revocation) => void): () => void {
    this.#revokedListeners.add(listener);
    return () => this.#revokedListeners.delete(listener);
  }

  async history(limit = 200): Promise<MessageHistory> {
    const result = await this.#api.request("GET", `/v1/messages?limit=${limit}`, { schema: MessageHistory, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      throw new Error(result.reason);
    }
    return result.value;
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

  async memory(): Promise<MemoryResult> {
    const result = await this.#api.request("GET", "/v1/memory", { schema: MemoryList, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true, list: result.value };
  }

  async saveMemory(draft: unknown): Promise<MemoryItemResult> {
    const parsed = MemoryDraft.safeParse(draft);
    if (!parsed.success) {
      return { ok: false, code: "invalid_request", reason: unreadableDraft };
    }
    return this.#memoryItem("POST", "/v1/memory", parsed.data);
  }

  async editMemory(memoryId: unknown, draft: unknown): Promise<MemoryItemResult> {
    const id = Id.safeParse(memoryId);
    const parsed = MemoryDraft.safeParse(draft);
    if (!id.success || !parsed.success) {
      return { ok: false, code: "invalid_request", reason: unreadableDraft };
    }
    return this.#memoryItem("PUT", `/v1/memory/${id.data}`, parsed.data);
  }

  async forgetMemory(memoryId: unknown): Promise<StepResult> {
    const id = Id.safeParse(memoryId);
    if (!id.success) {
      return { ok: false, code: "invalid_request", reason: "That memory does not exist any more." };
    }
    const result = await this.#api.request("DELETE", `/v1/memory/${id.data}`, { schema: MemoryForgotten, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true };
  }

  async #memoryItem(method: "POST" | "PUT", path: string, draft: MemoryDraft): Promise<MemoryItemResult> {
    const result = await this.#api.request(method, path, { schema: MemoryItem, body: draft, token: this.#token });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true, item: result.value };
  }

  async halt(stopId: string): Promise<HaltResult> {
    const result = await this.#api.request("POST", "/v1/stop", {
      schema: StopReceipt,
      body: { stop_id: stopId, scope: { kind: "all" } },
      token: this.#token,
    });
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return { ok: true, receipt: result.value };
  }

  async tasks(): Promise<TasksResult> {
    return this.#call(this.#api.request("GET", "/v1/tasks", { schema: TaskList, token: this.#token }), (list) => ({ ok: true, list }));
  }

  async drill(kind: DrillKind): Promise<TaskResult> {
    return this.#call(this.#api.request("POST", "/v1/tasks/drill", { schema: Task, body: { kind }, token: this.#token }), (task) => ({ ok: true, task }));
  }

  async control(taskId: unknown, control: unknown): Promise<TaskResult> {
    const id = Id.safeParse(taskId);
    const parsed = TaskControl.safeParse(control);
    if (!id.success || !parsed.success) {
      return { ok: false, code: "invalid_request", reason: "Write a short reason, in 300 characters or fewer." };
    }
    return this.#call(this.#api.request("POST", `/v1/tasks/${id.data}/control`, { schema: Task, body: parsed.data, token: this.#token }), (task) => ({ ok: true, task }));
  }

  async stopTask(taskId: string, stopId: string): Promise<TaskStopResult> {
    return this.#call(
      this.#api.request("POST", "/v1/stop", { schema: StopReceipt, body: { stop_id: stopId, scope: { kind: "task", task_id: taskId } }, token: this.#token }),
      (receipt) => ({ ok: true, receipt }),
    );
  }

  async confirm(taskId: string, stepId: string, decision: ConfirmDecision): Promise<AnswerResult> {
    const ids = Id.safeParse(taskId).success && Id.safeParse(stepId).success;
    if (!ids) {
      return { ok: false, code: "invalid_request", reason: "That confirmation does not exist any more." };
    }
    return this.#call(
      this.#api.request("POST", `/v1/tasks/${taskId}/steps/${stepId}/confirmation`, { schema: ConfirmationAnswered, body: { decision }, token: this.#token }),
      (answered) => ({ ok: true, answered }),
    );
  }

  async safety(): Promise<SafetyResult> {
    return this.#call(this.#api.request("GET", "/v1/settings/safety", { schema: SafetySettings, token: this.#token }), (settings) => ({ ok: true, settings }));
  }

  async setSafety(strictness: ConfirmationStrictness): Promise<SafetyResult> {
    return this.#call(
      this.#api.request("PUT", "/v1/settings/safety", { schema: SafetySettings, body: { confirmation_strictness: strictness }, token: this.#token }),
      (settings) => ({ ok: true, settings }),
    );
  }

  async report(report: CommandReport): Promise<StepResult> {
    const result = await this.#api.request("POST", "/v1/commands/report", { body: report, token: this.#token });
    return result.ok ? { ok: true } : result;
  }

  async #call<T, R>(pending: Promise<Result<T>>, success: (value: T) => R): Promise<R | Exclude<Result<T>, { ok: true }>> {
    const result = await pending;
    if (!result.ok) {
      this.#watch(result.code);
      return result;
    }
    return success(result.value);
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

  async #proof(token: string): Promise<Record<string, string> | null> {
    const trust = await this.#trust().catch(() => null);
    if (trust?.serverKey == null) {
      return {};
    }
    const challenge = await this.#api.request("POST", "/v1/live/challenge", { schema: LiveChallenge, token });
    if (!challenge.ok) {
      this.#watch(challenge.code);
      return null;
    }
    const { challenge_id, nonce } = challenge.value;
    return {
      "x-venom-challenge": challenge_id,
      "x-venom-signature": signText(trust.pair, liveChallengeText(trust.deviceId, challenge_id, nonce)),
    };
  }

  #connect(): void {
    const token = this.#token;
    if (token === null) {
      return;
    }
    this.#generation += 1;
    const generation = this.#generation;
    void this.#proof(token).then((proof) => {
      if (this.#token !== token || this.#generation !== generation) {
        return;
      }
      if (proof === null) {
        this.#setState("offline");
        this.#scheduleReconnect();
        return;
      }
      this.#open(token, proof);
    });
  }

  #open(token: string, proof: Record<string, string>): void {
    const url = this.#api.url("/v1/live");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}`, ...proof } });
    this.#socket = socket;

    socket.addEventListener("open", () => {
      if (this.#socket === socket) {
        this.#attempt = 0;
        this.#setState("online");
      }
    });

    socket.addEventListener("message", ({ data }) => {
      const frame = decodeFrame(data);
      if (frame === null || this.#socket !== socket) {
        return;
      }
      if (frame.kind === "command") {
        for (const listener of this.#commandListeners) {
          listener(frame.frame);
        }
        return;
      }
      for (const listener of this.#eventListeners) {
        listener(frame.event);
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
