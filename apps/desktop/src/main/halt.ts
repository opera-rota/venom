import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { HaltView } from "../shared/bridge.ts";
import type { HaltResult } from "./gateway-client.ts";

export interface HaltOptions {
  send(stopId: string): Promise<HaltResult>;
  haltLocally(): number;
  readonly waitMs?: number;
  readonly retryMs?: number;
  readonly settleMs?: number;
}

export class HaltController {
  readonly #options: HaltOptions;
  readonly #listeners = new Set<(view: HaltView) => void>();
  #view: HaltView = { kind: "idle" };
  #attempt: string | null = null;
  #timers: ReturnType<typeof setTimeout>[] = [];

  constructor(options: HaltOptions) {
    this.#options = options;
  }

  get view(): HaltView {
    return this.#view;
  }

  onChange(listener: (view: HaltView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  press(): string {
    this.#options.haltLocally();
    const stopId = randomUUID();
    this.#clearTimers();
    this.#attempt = stopId;
    this.#set({ kind: "stopping" });
    this.#later(() => {
      if (this.#attempt === stopId && this.#view.kind === "stopping") {
        this.#set({ kind: "waiting" });
      }
    }, this.#options.waitMs ?? 2000);
    void this.#deliver(stopId);
    return stopId;
  }

  close(): void {
    this.#attempt = null;
    this.#clearTimers();
  }

  async #deliver(stopId: string): Promise<void> {
    const retryMs = this.#options.retryMs ?? 1000;
    while (this.#attempt === stopId) {
      const result = await this.#options.send(stopId);
      if (this.#attempt !== stopId) {
        return;
      }
      if (result.ok) {
        this.#clearTimers();
        this.#set({ kind: "stopped", receipt: result.receipt });
        this.#later(() => {
          if (this.#attempt === stopId) {
            this.#attempt = null;
            this.#set({ kind: "idle" });
          }
        }, this.#options.settleMs ?? 4000);
        return;
      }
      if (result.code === "unauthorized") {
        this.#attempt = null;
        this.#clearTimers();
        this.#set({ kind: "failed", reason: result.reason });
        return;
      }
      if (result.code === "network" && this.#view.kind !== "local") {
        this.#set({ kind: "local" });
      }
      await sleep(retryMs);
    }
  }

  #later(run: () => void, ms: number): void {
    this.#timers.push(setTimeout(run, ms));
  }

  #clearTimers(): void {
    for (const timer of this.#timers.splice(0)) {
      clearTimeout(timer);
    }
  }

  #set(view: HaltView): void {
    this.#view = view;
    for (const listener of this.#listeners) {
      listener(view);
    }
  }
}
