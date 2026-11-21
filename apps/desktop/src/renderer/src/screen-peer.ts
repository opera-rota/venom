import type { ScreenCandidate, ScreenSignal } from "@venom/contracts";
import type { LiveQuality } from "./live-screen.ts";

export interface PeerCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
}

export type PeerState = "connecting" | "connected" | "unsteady" | "lost" | "closed";

export interface PeerEvents<S> {
  candidate(candidate: PeerCandidate): void;
  state(state: PeerState): void;
  stream(stream: S): void;
}

export interface Peer {
  offer(): Promise<string>;
  answer(offer: string): Promise<string>;
  accept(answer: string): Promise<void>;
  add(candidate: PeerCandidate): Promise<void>;
  quality(): Promise<LiveQuality | null>;
  close(): void;
}

export type SignalSend = (toDeviceId: string, sessionId: string, signal: ScreenSignal) => Promise<{ readonly ok: boolean }>;

export type Later = (run: () => void, ms: number) => () => void;

export function candidateSignal(candidate: PeerCandidate): ScreenSignal {
  return { kind: "candidate", candidate: candidate.candidate, sdp_mid: candidate.sdpMid, sdp_m_line_index: candidate.sdpMLineIndex };
}

export function signalCandidate(signal: ScreenCandidate): PeerCandidate {
  return { candidate: signal.candidate, sdpMid: signal.sdp_mid, sdpMLineIndex: signal.sdp_m_line_index };
}
