import type { ScreenSignal } from "@venom/contracts";
import { candidateSignal, signalCandidate, type Later, type Peer, type PeerEvents, type SignalSend } from "./screen-peer.ts";

export const shareLimits = {
  viewers: 3,
  connectMs: 20_000,
  unsteadyMs: 10_000,
} as const;

export interface SharerOptions<C> {
  readonly send: SignalSend;
  readonly capture: () => Promise<C | null>;
  readonly release: (capture: C) => void;
  readonly peer: (capture: C, events: PeerEvents<never>) => Peer;
  readonly later: Later;
  readonly changed: (watchers: readonly string[]) => void;
}

interface Session {
  readonly deviceId: string;
  peer: Peer | null;
  steady: boolean;
  cancel: () => void;
}

export class ScreenSharer<C> {
  readonly #options: SharerOptions<C>;
  readonly #sessions = new Map<string, Session>();
  #capture: Promise<C | null> | null = null;

  constructor(options: SharerOptions<C>) {
    this.#options = options;
  }

  get watchers(): readonly string[] {
    return [...new Set([...this.#sessions.values()].filter((session) => session.steady).map((session) => session.deviceId))];
  }

  receive(fromDeviceId: string, sessionId: string, signal: ScreenSignal): void {
    const session = this.#sessions.get(sessionId);
    if (signal.kind === "watch") {
      if (session === undefined) {
        void this.#open(fromDeviceId, sessionId);
      }
      return;
    }
    if (session === undefined || session.deviceId !== fromDeviceId) {
      return;
    }
    if (signal.kind === "leave") {
      this.#end(sessionId);
      return;
    }
    if (signal.kind === "answer") {
      void session.peer?.accept(signal.sdp).catch(() => this.#end(sessionId));
      return;
    }
    if (signal.kind === "candidate") {
      void session.peer?.add(signalCandidate(signal)).catch(() => undefined);
    }
  }

  closeAll(): void {
    for (const sessionId of [...this.#sessions.keys()]) {
      this.#end(sessionId);
    }
  }

  async #open(deviceId: string, sessionId: string): Promise<void> {
    if (this.#sessions.size >= shareLimits.viewers) {
      await this.#options.send(deviceId, sessionId, { kind: "refused" });
      return;
    }
    const session: Session = { deviceId, peer: null, steady: false, cancel: () => undefined };
    this.#sessions.set(sessionId, session);
    session.cancel = this.#options.later(() => this.#end(sessionId), shareLimits.connectMs);
    const capture = await this.#captured();
    if (this.#sessions.get(sessionId) !== session) {
      return;
    }
    if (capture === null) {
      this.#end(sessionId);
      await this.#options.send(deviceId, sessionId, { kind: "refused" });
      return;
    }
    session.peer = this.#options.peer(capture, {
      candidate: (candidate) => void this.#options.send(deviceId, sessionId, candidateSignal(candidate)),
      state: (state) => this.#follow(sessionId, session, state),
      stream: () => undefined,
    });
    try {
      const offer = await session.peer.offer();
      if (this.#sessions.get(sessionId) === session) {
        await this.#options.send(deviceId, sessionId, { kind: "offer", sdp: offer });
      }
    } catch {
      this.#end(sessionId);
    }
  }

  #follow(sessionId: string, session: Session, state: string): void {
    if (this.#sessions.get(sessionId) !== session) {
      return;
    }
    if (state === "connected") {
      session.cancel();
      session.cancel = () => undefined;
      if (!session.steady) {
        session.steady = true;
        this.#options.changed(this.watchers);
      }
      return;
    }
    if (state === "unsteady") {
      session.cancel();
      session.cancel = this.#options.later(() => this.#end(sessionId), shareLimits.unsteadyMs);
      return;
    }
    if (state === "lost" || state === "closed") {
      this.#end(sessionId);
    }
  }

  #captured(): Promise<C | null> {
    if (this.#capture === null) {
      const pending = this.#options.capture().catch(() => null);
      this.#capture = pending;
      void pending.then((capture) => {
        if (capture === null && this.#capture === pending) {
          this.#capture = null;
        }
      });
    }
    return this.#capture;
  }

  #end(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    this.#sessions.delete(sessionId);
    session.cancel();
    session.peer?.close();
    if (session.steady) {
      this.#options.changed(this.watchers);
    }
    if (this.#sessions.size === 0) {
      this.#releaseCapture();
    }
  }

  #releaseCapture(): void {
    const pending = this.#capture;
    this.#capture = null;
    void pending?.then((capture) => {
      if (capture !== null) {
        this.#options.release(capture);
      }
    });
  }
}
