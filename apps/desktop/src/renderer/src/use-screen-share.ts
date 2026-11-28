import type { Device } from "@venom/contracts";
import { useEffect, useMemo, useState } from "react";
import type { VenomBridge } from "../../shared/bridge.ts";
import { canShare, type ScreenShare } from "./live-screen.ts";
import { captureOptions, laterWithTimers, sendingPeer } from "./rtc-peer.ts";
import { ScreenSharer } from "./screen-share.ts";

function release(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function useScreenShare(bridge: VenomBridge, devices: readonly Device[], self: Device): ScreenShare {
  const [watcherIds, setWatcherIds] = useState<readonly string[]>([]);
  const [controllerId, setControllerId] = useState<string | null>(null);
  const current = devices.find((device) => device.id === self.id) ?? self;
  const sharing = canShare(current);

  useEffect(() => {
    if (!sharing) {
      return;
    }
    const sharer: ScreenSharer<MediaStream> = new ScreenSharer<MediaStream>({
      send: (toDeviceId, sessionId, signal) => bridge.screenSignal(toDeviceId, sessionId, signal),
      capture: async () => {
        const stream = await navigator.mediaDevices.getDisplayMedia(captureOptions);
        for (const track of stream.getVideoTracks()) {
          track.addEventListener("ended", () => sharer.closeAll(), { once: true });
        }
        return stream;
      },
      release,
      peer: sendingPeer,
      later: laterWithTimers,
      changed: setWatcherIds,
    });
    const offEvent = bridge.onEvent((event) => {
      if (event.type === "screen_signal") {
        sharer.receive(event.from_device_id, event.session_id, event.signal);
      }
    });
    const offConnection = bridge.onConnection((state) => {
      if (state === "offline") {
        sharer.closeAll();
      }
    });
    return () => {
      offEvent();
      offConnection();
      sharer.closeAll();
      setWatcherIds([]);
    };
  }, [bridge, sharing]);

  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (event.type === "remote" && event.to_device_id === self.id) {
          setControllerId((current) => (event.on ? event.from_device_id : current === event.from_device_id ? null : current));
        }
      }),
    [bridge, self.id],
  );

  const watchers = useMemo(() => devices.filter((device) => watcherIds.includes(device.id)), [devices, watcherIds]);
  const controllers = useMemo(() => watchers.filter((device) => device.id === controllerId), [watchers, controllerId]);
  return { watchers, controllers };
}
