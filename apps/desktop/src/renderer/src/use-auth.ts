import { useEffect, useState } from "react";
import type { AuthView, VenomBridge } from "../../shared/bridge.ts";

export function useAuth(bridge: VenomBridge): AuthView {
  const [view, setView] = useState<AuthView>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    const stop = bridge.onAuth((next) => {
      if (active) {
        setView(next);
      }
    });
    void bridge.auth().then((current) => {
      if (active) {
        setView((previous) => (previous.kind === "loading" ? current : previous));
      }
    });
    return () => {
      active = false;
      stop();
    };
  }, [bridge]);

  return view;
}
