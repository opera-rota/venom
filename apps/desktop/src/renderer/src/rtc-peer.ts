import type { LiveQuality } from "./live-screen.ts";
import type { Peer, PeerCandidate, PeerEvents, PeerState } from "./screen-peer.ts";

const rtcConfig: RTCConfiguration = { iceServers: [], bundlePolicy: "max-bundle" };

const sendLimits = { bitrate: 6_000_000, fps: 30 } as const;

const states: Readonly<Record<RTCPeerConnectionState, PeerState>> = {
  new: "connecting",
  connecting: "connecting",
  connected: "connected",
  disconnected: "unsteady",
  failed: "lost",
  closed: "closed",
};

export const captureOptions: DisplayMediaStreamOptions = {
  video: { frameRate: { ideal: sendLimits.fps, max: sendLimits.fps }, width: { max: 1920 }, height: { max: 1080 } },
  audio: false,
};

function inboundQuality(report: RTCStatsReport): LiveQuality | null {
  for (const entry of report.values()) {
    const stats = entry as RTCInboundRtpStreamStats;
    if (stats.type === "inbound-rtp" && stats.kind === "video" && stats.frameWidth !== undefined && stats.frameHeight !== undefined) {
      return { width: stats.frameWidth, height: stats.frameHeight, fps: Math.round(stats.framesPerSecond ?? 0) };
    }
  }
  return null;
}

function connect(events: PeerEvents<MediaStream>, prepare: (connection: RTCPeerConnection) => void): Peer {
  const connection = new RTCPeerConnection(rtcConfig);
  const waiting: PeerCandidate[] = [];
  let described = false;

  connection.onicecandidate = ({ candidate }) => {
    if (candidate !== null && candidate.candidate !== "") {
      events.candidate({ candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
    }
  };
  connection.onconnectionstatechange = () => events.state(states[connection.connectionState]);
  connection.ontrack = ({ streams, track }) => events.stream(streams[0] ?? new MediaStream([track]));
  prepare(connection);

  async function remote(description: RTCSessionDescriptionInit): Promise<void> {
    await connection.setRemoteDescription(description);
    described = true;
    for (const candidate of waiting.splice(0)) {
      await connection.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  async function local(made: RTCSessionDescriptionInit): Promise<string> {
    await connection.setLocalDescription(made);
    return connection.localDescription?.sdp ?? made.sdp ?? "";
  }

  return {
    offer: async () => local(await connection.createOffer()),
    answer: async (offer) => {
      await remote({ type: "offer", sdp: offer });
      return local(await connection.createAnswer());
    },
    accept: (answer) => remote({ type: "answer", sdp: answer }),
    add: async (candidate) => {
      if (!described) {
        waiting.push(candidate);
        return;
      }
      await connection.addIceCandidate(candidate);
    },
    quality: async () => inboundQuality(await connection.getStats()),
    close: () => connection.close(),
  };
}

export function sendingPeer(stream: MediaStream, events: PeerEvents<MediaStream>): Peer {
  return connect(events, (connection) => {
    for (const track of stream.getVideoTracks()) {
      track.contentHint = "detail";
      connection.addTransceiver(track, {
        direction: "sendonly",
        streams: [stream],
        sendEncodings: [{ maxBitrate: sendLimits.bitrate, maxFramerate: sendLimits.fps }],
      });
    }
  });
}

export function receivingPeer(events: PeerEvents<MediaStream>): Peer {
  return connect(events, () => undefined);
}

export function laterWithTimers(run: () => void, ms: number): () => void {
  const timer = window.setTimeout(run, ms);
  return () => window.clearTimeout(timer);
}
