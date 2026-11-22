import type { Device } from "@venom/contracts";
import { useEffect, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";
import { watchedDevice, type LivePhase, type LiveScreen } from "./live-screen.ts";
import { laterWithTimers, receivingPeer } from "./rtc-peer.ts";
import { ScreenWatcher, type WatchView } from "./screen-watch.ts";

const resting: WatchView<MediaStream> = { phase: "idle", stream: null, quality: null };

function phaseOf(watching: Device | null, target: string | null, view: WatchView<MediaStream>): LivePhase {
  if (watching === null) {
    return "idle";
  }
  if (watching.status !== "active") {
    return "offline";
  }
  if (watching.locked) {
    return "locked";
  }
  return target === null || view.phase === "idle" ? "connecting" : view.phase;
}

export function useLiveScreen(bridge: VenomBridge, devices: readonly Device[], selfId: string, connection: ConnectionState, active: boolean): LiveScreen<MediaStream> {
  const [view, setView] = useState<WatchView<MediaStream>>(resting);
  const [watcher] = useState(
    () =>
      new ScreenWatcher<MediaStream>({
        send: (toDeviceId, sessionId, signal) => bridge.screenSignal(toDeviceId, sessionId, signal),
        peer: receivingPeer,
        session: () => crypto.randomUUID(),
        later: laterWithTimers,
        changed: setView,
      }),
  );
  const watching = watchedDevice(devices, selfId);
  const reachable = active && connection === "online" && watching !== null && watching.status === "active" && !watching.locked;
  const target = reachable ? watching.id : null;

  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (event.type === "screen_signal") {
          watcher.receive(event.from_device_id, event.session_id, event.signal);
        }
      }),
    [bridge, watcher],
  );

  useEffect(() => watcher.watch(target), [watcher, target]);

  useEffect(() => () => watcher.close(), [watcher]);

  const phase = phaseOf(watching, target, view);

  return {
    watching,
    phase,
    stream: phase === "live" ? view.stream : null,
    quality: phase === "live" ? view.quality : null,
    retry: () => watcher.retry(),
  };
}
