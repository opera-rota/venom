import type { ScreenSignal } from "@venom/contracts";
import type { LivePhase, LiveQuality } from "./live-screen.ts";
import { candidateSignal, signalCandidate, type Later, type Peer, type PeerEvents, type SignalSend } from "./screen-peer.ts";

export const watchLimits = {
  connectMs: 15_000,
  unsteadyMs: 4_000,
  qualityMs: 2_000,
  retryMs: [1_500, 3_000, 6_000, 12_000],
} as const;

export interface WatchView<S> {
  readonly phase: LivePhase;
  readonly stream: S | null;
  readonly quality: LiveQuality | null;
}

export interface WatcherOptions<S> {
  readonly send: SignalSend;
  readonly peer: (events: PeerEvents<S>) => Peer;
  readonly session: () => string;
  readonly later: Later;
  readonly changed: (view: WatchView<S>) => void;
}

interface Watching {
  readonly deviceId: string;
  readonly sessionId: string;
  peer: Peer | null;
  stream: unknown;
  connected: boolean;
}

export class ScreenWatcher<S> {
  readonly #options: WatcherOptions<S>;
  #target: string | null = null;
  #current: Watching | null = null;
  #view: WatchView<S> = { phase: "idle", stream: null, quality: null };
  #attempts = 0;
  #cancelTimer: () => void = () => undefined;
  #cancelRetry: () => void = () => undefined;
  #cancelQuality: () => void = () => undefined;

  constructor(options: WatcherOptions<S>) {
    this.#options = options;
  }

  get view(): WatchView<S> {
    return this.#view;
  }

  watch(deviceId: string | null): void {
    if (deviceId === this.#target) {
      return;
    }
    this.#target = deviceId;
    this.#attempts = 0;
    this.#cancelRetry();
    this.#leave();
    if (deviceId === null) {
      this.#show({ phase: "idle", stream: null, quality: null });
      return;
    }
    void this.#start(deviceId);
  }

  retry(): void {
    if (this.#target === null) {
      return;
    }
    this.#attempts = 0;
    this.#cancelRetry();
    this.#leave();
    void this.#start(this.#target);
  }

  receive(fromDeviceId: string, sessionId: string, signal: ScreenSignal): void {
    const current = this.#current;
    if (current === null || current.sessionId !== sessionId || current.deviceId !== fromDeviceId) {
      return;
    }
    if (signal.kind === "offer") {
      void this.#answer(current, signal.sdp);
      return;
    }
    if (signal.kind === "candidate") {
      void current.peer?.add(signalCandidate(signal)).catch(() => undefined);
      return;
    }
    if (signal.kind === "refused" || signal.kind === "leave") {
      this.#lost(current);
    }
  }

  close(): void {
    this.#target = null;
    this.#cancelRetry();
    this.#leave();
    this.#show({ phase: "idle", stream: null, quality: null });
  }

  async #start(deviceId: string): Promise<void> {
    const current: Watching = { deviceId, sessionId: this.#options.session(), peer: null, stream: null, connected: false };
    this.#current = current;
    this.#show({ phase: "connecting", stream: null, quality: null });
    this.#cancelTimer = this.#options.later(() => this.#lost(current), watchLimits.connectMs);
    const sent = await this.#options.send(deviceId, current.sessionId, { kind: "watch" });
    if (!sent.ok && this.#current === current) {
      this.#lost(current);
    }
  }

  async #answer(current: Watching, offer: string): Promise<void> {
    if (current.peer !== null) {
      return;
    }
    current.peer = this.#options.peer({
      candidate: (candidate) => void this.#options.send(current.deviceId, current.sessionId, candidateSignal(candidate)),
      state: (state) => this.#follow(current, state),
      stream: (stream) => {
        current.stream = stream;
        this.#reveal(current);
      },
    });
    try {
      const answer = await current.peer.answer(offer);
      if (this.#current === current) {
        await this.#options.send(current.deviceId, current.sessionId, { kind: "answer", sdp: answer });
      }
    } catch {
      this.#lost(current);
    }
  }

  #follow(current: Watching, state: string): void {
    if (this.#current !== current) {
      return;
    }
    if (state === "connected") {
      current.connected = true;
      this.#cancelTimer();
      this.#cancelTimer = () => undefined;
      this.#reveal(current);
      return;
    }
    if (state === "unsteady") {
      this.#cancelTimer();
      this.#cancelTimer = this.#options.later(() => this.#lost(current), watchLimits.unsteadyMs);
      return;
    }
    if (state === "lost" || state === "closed") {
      this.#lost(current);
    }
  }

  #reveal(current: Watching): void {
    if (this.#current !== current || !current.connected || current.stream === null) {
      return;
    }
    this.#attempts = 0;
    this.#show({ phase: "live", stream: current.stream as S, quality: this.#view.quality });
    this.#measure(current);
  }

  #measure(current: Watching): void {
    this.#cancelQuality();
    this.#cancelQuality = this.#options.later(() => {
      void current.peer?.quality().then((quality) => {
        if (this.#current === current && this.#view.phase === "live") {
          if (quality !== null) {
            this.#show({ ...this.#view, quality });
          }
          this.#measure(current);
        }
      });
    }, watchLimits.qualityMs);
  }

  #lost(current: Watching): void {
    if (this.#current !== current) {
      return;
    }
    const target = this.#target;
    this.#leave();
    this.#show({ phase: "lost", stream: null, quality: null });
    if (target === null) {
      return;
    }
    const wait = watchLimits.retryMs[Math.min(this.#attempts, watchLimits.retryMs.length - 1)] ?? 12_000;
    this.#attempts += 1;
    this.#cancelRetry();
    this.#cancelRetry = this.#options.later(() => {
      if (this.#target === target && this.#current === null) {
        void this.#start(target);
      }
    }, wait);
  }

  #leave(): void {
    const current = this.#current;
    this.#current = null;
    this.#cancelTimer();
    this.#cancelQuality();
    this.#cancelTimer = () => undefined;
    this.#cancelQuality = () => undefined;
    if (current === null) {
      return;
    }
    current.peer?.close();
    void this.#options.send(current.deviceId, current.sessionId, { kind: "leave" });
  }

  #show(view: WatchView<S>): void {
    this.#view = view;
    this.#options.changed(view);
  }
}
