import { useEffect, useState } from "react";
import type { VenomBridge } from "../../shared/bridge.ts";
import type { LiveScreen } from "./live-screen.ts";
import type { RemoteControl } from "./remote.ts";

export function useRemote(bridge: VenomBridge, live: LiveScreen<MediaStream>, held: boolean, resume: () => void): RemoteControl {
  const [on, setOn] = useState(false);
  const targetId = live.phase === "live" ? (live.watching?.id ?? null) : null;
  const active = on && targetId !== null;

  useEffect(() => {
    if (!active || targetId === null) {
      return;
    }
    let current = true;
    void bridge.remoteSession(targetId, true).then((result) => {
      if (current && !result.ok) {
        setOn(false);
      }
    });
    return () => {
      current = false;
      void bridge.remoteSession(targetId, false);
    };
  }, [bridge, active, targetId]);

  return {
    ready: targetId !== null,
    on: active,
    paused: active && held,
    toggle: () => setOn((value) => !value),
    send: (action) => {
      if (targetId !== null) {
        void bridge.remote(targetId, action);
      }
    },
    resume,
  };
}
