import type { LaterItem } from "@venom/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";
import { applyLaterEvent, withLater, withoutLater } from "./later-state.ts";

export interface LaterState {
  readonly items: readonly LaterItem[];
  readonly loaded: boolean;
  readonly failure: string | null;
  seen(itemId: string): Promise<boolean>;
  remove(itemId: string): Promise<boolean>;
}

export function useLater(bridge: VenomBridge, connection: ConnectionState): LaterState {
  const [items, setItems] = useState<readonly LaterItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const stop = bridge.onEvent((event) => {
      if (active) {
        setItems((current) => applyLaterEvent(current, event));
      }
    });
    if (connection === "online") {
      void bridge.later().then((result) => {
        if (!active) {
          return;
        }
        if (result.ok) {
          setItems(result.list.items);
          setLoaded(true);
          setFailure(null);
        } else {
          setFailure(result.reason);
        }
      });
    }
    return () => {
      active = false;
      stop();
    };
  }, [bridge, connection]);

  const seen = useCallback(
    async (itemId: string) => {
      const result = await bridge.laterSeen(itemId);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setItems((current) => withLater(current, result.item));
      }
      return result.ok;
    },
    [bridge],
  );

  const remove = useCallback(
    async (itemId: string) => {
      const result = await bridge.laterRemove(itemId);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setItems((current) => withoutLater(current, itemId));
      }
      return result.ok;
    },
    [bridge],
  );

  return { items, loaded, failure, seen, remove };
}
