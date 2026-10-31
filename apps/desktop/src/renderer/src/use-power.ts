import type { Engine, EngineId, PowerStatus } from "@venom/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";

export interface PowerState {
  readonly power: PowerStatus | null;
  readonly engines: readonly Engine[];
  readonly choosing: EngineId | null;
  readonly failure: string | null;
  choose(engine: EngineId): Promise<void>;
}

export function usePower(bridge: VenomBridge, connection: ConnectionState): PowerState {
  const [power, setPower] = useState<PowerStatus | null>(null);
  const [engines, setEngines] = useState<readonly Engine[]>([]);
  const [choosing, setChoosing] = useState<EngineId | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const stop = bridge.onEvent((event) => {
      if (event.type === "power" && active) {
        setPower(event.power);
      }
    });
    if (connection === "online") {
      void Promise.all([bridge.power(), bridge.engines()]).then(([status, list]) => {
        if (!active) {
          return;
        }
        if (status.ok) {
          setPower(status.power);
        }
        if (list.ok) {
          setEngines(list.list.engines);
        }
        setFailure(!status.ok ? status.reason : !list.ok ? list.reason : null);
      });
    }
    return () => {
      active = false;
      stop();
    };
  }, [bridge, connection]);

  const choose = useCallback(
    async (engine: EngineId) => {
      setChoosing(engine);
      const result = await bridge.chooseEngine(engine);
      setChoosing(null);
      if (result.ok) {
        setPower(result.power);
        setFailure(null);
      } else {
        setFailure(result.reason);
      }
    },
    [bridge],
  );

  return { power, engines, choosing, failure, choose };
}
