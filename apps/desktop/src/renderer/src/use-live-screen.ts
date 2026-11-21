import type { Device } from "@venom/contracts";
import { useEffect, useMemo, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";
import { firstSource, screenSources, type LiveScreen } from "./live-screen.ts";
import { laterWithTimers, receivingPeer } from "./rtc-peer.ts";
import { ScreenWatcher, type WatchView } from "./screen-watch.ts";

const resting: WatchView<MediaStream> = { phase: "idle", stream: null, quality: null };

export function useLiveScreen(bridge: VenomBridge, devices: readonly Device[], selfId: string, connection: ConnectionState, active: boolean, preferred: string | null): LiveScreen<MediaStream> {
  const sources = useMemo(() => screenSources(devices, selfId), [devices, selfId]);
  const [chosen, setChosen] = useState<string | null>(null);
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
  const watching = firstSource(sources, chosen ?? preferred);
  const reachable = active && connection === "online" && watching?.status === "active";
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

  const phase = watching === null ? "idle" : watching.status !== "active" ? "offline" : target === null ? "connecting" : view.phase === "idle" ? "connecting" : view.phase;

  return {
    sources,
    watching,
    phase,
    stream: phase === "live" ? view.stream : null,
    quality: phase === "live" ? view.quality : null,
    watch: setChosen,
    retry: () => watcher.retry(),
  };
}
