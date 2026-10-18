import type { Device } from "@venom/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";

export interface DevicesState {
  readonly devices: readonly Device[];
  readonly currentId: string;
  readonly failure: string | null;
  remove(deviceId: string): Promise<boolean>;
}

export function useDevices(bridge: VenomBridge, currentId: string, connection: ConnectionState): DevicesState {
  const [devices, setDevices] = useState<readonly Device[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const stop = bridge.onEvent((event) => {
      if (event.type === "devices" && active) {
        setDevices(event.devices);
      }
    });
    if (connection === "online") {
      void bridge.devices().then((result) => {
        if (!active) {
          return;
        }
        if (result.ok) {
          setDevices(result.list.devices);
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

  const remove = useCallback(
    async (deviceId: string) => {
      const result = deviceId === currentId ? await bridge.signOut() : await bridge.removeDevice(deviceId);
      setFailure(result.ok ? null : result.reason);
      return result.ok;
    },
    [bridge, currentId],
  );

  return { devices, currentId, failure, remove };
}
