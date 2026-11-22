import type { Device, ScreenSignal } from "@venom/contracts";
import { describe, expect, it } from "vitest";
import { awakeFor, deviceInUse, watchedDevice, watcherWords, workers } from "../src/renderer/src/live-screen.ts";
import type { Peer, PeerEvents, PeerState } from "../src/renderer/src/screen-peer.ts";
import { ScreenSharer, shareLimits } from "../src/renderer/src/screen-share.ts";
import { ScreenWatcher, watchLimits, type WatchView } from "../src/renderer/src/screen-watch.ts";

const accountId = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e01";
const laptop = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e02";
const phone = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e03";
const tablet = "0199d2a0-7c1e-7a3b-9f2d-1a2b3c4d5e04";

function device(id: string, type: Device["type"], name: string, status: Device["status"] = "active", inUse = false): Device {
  const control = type === "computer";
  return {
    id,
    account_id: accountId,
    type,
    name,
    platform: type === "computer" ? "windows" : "android",
    capabilities: { screen_control: control, microphone: true, speaker: true, shortcuts: control, notifications: true, network: true },
    status,
    last_seen_at: null,
    in_use: inUse,
    locked: false,
  };
}

interface Sent {
  readonly to: string;
  readonly session: string;
  readonly signal: ScreenSignal;
}

function clock() {
  let now = 0;
  const timers = new Set<{ at: number; run: () => void }>();
  return {
    later(run: () => void, ms: number) {
      const timer = { at: now + ms, run };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers].sort((left, right) => left.at - right.at)) {
        if (timer.at <= now && timers.delete(timer)) {
          timer.run();
        }
      }
    },
  };
}

class FakePeer implements Peer {
  closed = false;
  added: string[] = [];
  remote: string | null = null;
  readonly events: PeerEvents<string>;

  constructor(events: PeerEvents<string>) {
    this.events = events;
  }

  async offer() {
    return "offer-sdp";
  }

  async answer(offer: string) {
    this.remote = offer;
    return "answer-sdp";
  }

  async accept(answer: string) {
    this.remote = answer;
  }

  async add(candidate: { readonly candidate: string }) {
    this.added.push(candidate.candidate);
  }

  async quality() {
    return { width: 1920, height: 1080, fps: 30 };
  }

  close() {
    this.closed = true;
  }

  become(state: PeerState) {
    this.events.state(state);
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function sharerRig(capture: () => Promise<string | null> = async () => "screen") {
  const sent: Sent[] = [];
  const peers: FakePeer[] = [];
  const released: string[] = [];
  const watcherLists: (readonly string[])[] = [];
  let captures = 0;
  const time = clock();
  const sharer = new ScreenSharer<string>({
    send: async (to, session, signal) => {
      sent.push({ to, session, signal });
      return { ok: true };
    },
    capture: () => {
      captures += 1;
      return capture();
    },
    release: (stream) => released.push(stream),
    peer: (_stream, events) => {
      const peer = new FakePeer(events as PeerEvents<string>);
      peers.push(peer);
      return peer;
    },
    later: time.later,
    changed: (watchers) => watcherLists.push(watchers),
  });
  return { sharer, sent, peers, released, watcherLists, time, captures: () => captures };
}

function watcherRig() {
  const sent: Sent[] = [];
  const peers: FakePeer[] = [];
  const views: WatchView<string>[] = [];
  const time = clock();
  let sessions = 0;
  let reachable = true;
  const watcher = new ScreenWatcher<string>({
    send: async (to, session, signal) => {
      sent.push({ to, session, signal });
      return { ok: reachable };
    },
    peer: (events) => {
      const peer = new FakePeer(events);
      peers.push(peer);
      return peer;
    },
    session: () => `0199d2a0-7c1e-7a3b-9f2d-00000000000${(sessions += 1)}`,
    later: time.later,
    changed: (view) => views.push(view),
  });
  return { watcher, sent, peers, views, time, unreachable: () => (reachable = false) };
}

describe("the device in use and its screen", () => {
  it("offers only computers, online ones first, and watches the one in use unless it is this device", () => {
    const devices = [device(tablet, "computer", "Home PC", "offline"), device(phone, "phone", "Android phone"), device(laptop, "computer", "RS-APP-CED", "active", true)];
    expect(workers(devices).map((entry) => entry.name)).toEqual(["RS-APP-CED", "Home PC"]);
    expect(deviceInUse(devices)?.name).toBe("RS-APP-CED");
    expect(watchedDevice(devices, phone)?.name).toBe("RS-APP-CED");
    expect(watchedDevice(devices, laptop)).toBeNull();
    expect(watchedDevice([device(laptop, "computer", "RS-APP-CED")], phone)).toBeNull();
    expect(watcherWords([device(phone, "phone", "Android phone")])).toBe("Watched from Android phone");
    expect(watcherWords([])).toBeNull();
  });

  it("keeps the computer in use from sleeping, and its display on while watched or working", () => {
    const inUse = device(laptop, "computer", "RS-APP-CED", "active", true);
    const spare = device(tablet, "computer", "Home PC");
    expect(awakeFor(inUse, false, false)).toBe("system");
    expect(awakeFor(inUse, true, false)).toBe("display");
    expect(awakeFor(spare, false, true)).toBe("display");
    expect(awakeFor(spare, false, false)).toBe("none");
    expect(awakeFor(null, false, false)).toBe("none");
  });
});

describe("sharing this computer's screen", () => {
  it("captures once, offers to the watcher, and follows the answer and candidates", async () => {
    const rig = sharerRig();
    rig.sharer.receive(phone, "s1", { kind: "watch" });
    await settle();
    expect(rig.captures()).toBe(1);
    expect(rig.sent).toEqual([{ to: phone, session: "s1", signal: { kind: "offer", sdp: "offer-sdp" } }]);

    rig.sharer.receive(phone, "s1", { kind: "answer", sdp: "their-answer" });
    rig.sharer.receive(phone, "s1", { kind: "candidate", candidate: "candidate:1", sdp_mid: "0", sdp_m_line_index: 0 });
    await settle();
    expect(rig.peers[0]?.remote).toBe("their-answer");
    expect(rig.peers[0]?.added).toEqual(["candidate:1"]);

    rig.peers[0]?.events.candidate({ candidate: "candidate:2", sdpMid: "0", sdpMLineIndex: 0 });
    await settle();
    expect(rig.sent.at(-1)).toEqual({ to: phone, session: "s1", signal: { kind: "candidate", candidate: "candidate:2", sdp_mid: "0", sdp_m_line_index: 0 } });
  });

  it("says who watches only once the picture flows, and stops capturing when the last watcher leaves", async () => {
    const rig = sharerRig();
    rig.sharer.receive(phone, "s1", { kind: "watch" });
    await settle();
    expect(rig.watcherLists).toEqual([]);
    rig.peers[0]?.become("connected");
    expect(rig.watcherLists.at(-1)).toEqual([phone]);

    rig.sharer.receive(tablet, "s1", { kind: "leave" });
    expect(rig.peers[0]?.closed).toBe(false);
    rig.sharer.receive(phone, "s1", { kind: "leave" });
    await settle();
    expect(rig.peers[0]?.closed).toBe(true);
    expect(rig.watcherLists.at(-1)).toEqual([]);
    expect(rig.released).toEqual(["screen"]);
  });

  it("refuses kindly when the screen cannot be captured or too many devices watch", async () => {
    const refused = sharerRig(async () => null);
    refused.sharer.receive(phone, "s1", { kind: "watch" });
    await settle();
    expect(refused.sent).toEqual([{ to: phone, session: "s1", signal: { kind: "refused" } }]);

    const crowded = sharerRig();
    for (let index = 0; index <= shareLimits.viewers; index += 1) {
      crowded.sharer.receive(phone, `s${index}`, { kind: "watch" });
    }
    await settle();
    expect(crowded.sent.filter((entry) => entry.signal.kind === "refused").map((entry) => entry.session)).toEqual([`s${shareLimits.viewers}`]);
    expect(crowded.captures()).toBe(1);
  });

  it("drops a watcher that never connects or stays unsteady", async () => {
    const rig = sharerRig();
    rig.sharer.receive(phone, "s1", { kind: "watch" });
    await settle();
    rig.time.advance(shareLimits.connectMs);
    await settle();
    expect(rig.peers[0]?.closed).toBe(true);
    expect(rig.released).toEqual(["screen"]);

    rig.sharer.receive(phone, "s2", { kind: "watch" });
    await settle();
    rig.peers[1]?.become("connected");
    rig.peers[1]?.become("unsteady");
    rig.time.advance(shareLimits.unsteadyMs - 1);
    expect(rig.peers[1]?.closed).toBe(false);
    rig.peers[1]?.become("connected");
    rig.time.advance(shareLimits.unsteadyMs);
    expect(rig.peers[1]?.closed).toBe(false);
    rig.peers[1]?.become("lost");
    expect(rig.peers[1]?.closed).toBe(true);
  });
});

describe("watching another computer's screen", () => {
  it("asks to watch, answers the offer, and goes live when the picture arrives", async () => {
    const rig = watcherRig();
    rig.watcher.watch(laptop);
    await settle();
    const session = rig.sent[0]?.session ?? "";
    expect(rig.sent[0]).toEqual({ to: laptop, session, signal: { kind: "watch" } });
    expect(rig.views.at(-1)?.phase).toBe("connecting");

    rig.watcher.receive(laptop, session, { kind: "candidate", candidate: "candidate:9", sdp_mid: "0", sdp_m_line_index: 0 });
    rig.watcher.receive(laptop, session, { kind: "offer", sdp: "their-offer" });
    await settle();
    expect(rig.peers[0]?.remote).toBe("their-offer");
    expect(rig.sent.at(-1)).toEqual({ to: laptop, session, signal: { kind: "answer", sdp: "answer-sdp" } });

    rig.peers[0]?.events.stream("video");
    expect(rig.views.at(-1)?.phase).toBe("connecting");
    rig.peers[0]?.become("connected");
    expect(rig.views.at(-1)).toEqual({ phase: "live", stream: "video", quality: null });
    rig.time.advance(watchLimits.qualityMs);
    await settle();
    expect(rig.views.at(-1)?.quality).toEqual({ width: 1920, height: 1080, fps: 30 });
  });

  it("ignores signals from another device or an old session", async () => {
    const rig = watcherRig();
    rig.watcher.watch(laptop);
    await settle();
    const session = rig.sent[0]?.session ?? "";
    rig.watcher.receive(tablet, session, { kind: "offer", sdp: "not-yours" });
    rig.watcher.receive(laptop, "0199d2a0-7c1e-7a3b-9f2d-0000000000ff", { kind: "offer", sdp: "old" });
    await settle();
    expect(rig.peers).toEqual([]);
  });

  it("says goodbye when leaving, and switching screens starts a new session", async () => {
    const rig = watcherRig();
    rig.watcher.watch(laptop);
    await settle();
    const first = rig.sent[0]?.session ?? "";
    rig.watcher.watch(tablet);
    await settle();
    expect(rig.sent.map((entry) => [entry.to, entry.signal.kind])).toEqual([
      [laptop, "watch"],
      [laptop, "leave"],
      [tablet, "watch"],
    ]);
    expect(rig.sent[2]?.session).not.toBe(first);
    rig.watcher.watch(null);
    expect(rig.views.at(-1)?.phase).toBe("idle");
    expect(rig.sent.at(-1)?.signal.kind).toBe("leave");
  });

  it("when the picture drops, says so and tries again by itself, waiting longer each time", async () => {
    const rig = watcherRig();
    rig.watcher.watch(laptop);
    await settle();
    const session = rig.sent[0]?.session ?? "";
    rig.watcher.receive(laptop, session, { kind: "offer", sdp: "their-offer" });
    await settle();
    rig.peers[0]?.events.stream("video");
    rig.peers[0]?.become("connected");
    rig.peers[0]?.become("unsteady");
    rig.time.advance(watchLimits.unsteadyMs);
    expect(rig.views.at(-1)?.phase).toBe("lost");
    expect(rig.peers[0]?.closed).toBe(true);

    rig.unreachable();
    rig.time.advance(watchLimits.retryMs[0]);
    await settle();
    expect(rig.sent.filter((entry) => entry.signal.kind === "watch")).toHaveLength(2);
    expect(rig.views.at(-1)?.phase).toBe("lost");
    rig.time.advance(watchLimits.retryMs[0]);
    await settle();
    expect(rig.sent.filter((entry) => entry.signal.kind === "watch")).toHaveLength(2);
    rig.time.advance(watchLimits.retryMs[1]);
    await settle();
    expect(rig.sent.filter((entry) => entry.signal.kind === "watch")).toHaveLength(3);
  });

  it("treats a refusal or a sharer that never answers as a drop", async () => {
    const rig = watcherRig();
    rig.watcher.watch(laptop);
    await settle();
    rig.watcher.receive(laptop, rig.sent[0]?.session ?? "", { kind: "refused" });
    expect(rig.views.at(-1)?.phase).toBe("lost");

    const silent = watcherRig();
    silent.watcher.watch(laptop);
    await settle();
    silent.time.advance(watchLimits.connectMs);
    expect(silent.views.at(-1)?.phase).toBe("lost");
  });
});
