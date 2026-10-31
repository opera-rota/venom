import { memoryLimits, type MemoryDraft, type MemoryItem } from "@venom/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";
import { applyMemoryEvent, withItem, withoutItem } from "./memory-state.ts";

export interface MemoryState {
  readonly items: readonly MemoryItem[];
  readonly limit: number;
  readonly loaded: boolean;
  readonly failure: string | null;
  add(draft: MemoryDraft): Promise<boolean>;
  edit(memoryId: string, draft: MemoryDraft): Promise<boolean>;
  forget(memoryId: string): Promise<boolean>;
}

export function useMemory(bridge: VenomBridge, connection: ConnectionState): MemoryState {
  const [items, setItems] = useState<readonly MemoryItem[]>([]);
  const [limit, setLimit] = useState<number>(memoryLimits.items);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const stop = bridge.onEvent((event) => {
      if (active) {
        setItems((current) => applyMemoryEvent(current, event));
      }
    });
    if (connection === "online") {
      void bridge.memory().then((result) => {
        if (!active) {
          return;
        }
        if (result.ok) {
          setItems(result.list.items);
          setLimit(result.list.limit);
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

  const add = useCallback(
    async (draft: MemoryDraft) => {
      const result = await bridge.saveMemory(draft);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setItems((current) => withItem(current, result.item));
      }
      return result.ok;
    },
    [bridge],
  );

  const edit = useCallback(
    async (memoryId: string, draft: MemoryDraft) => {
      const result = await bridge.editMemory(memoryId, draft);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setItems((current) => withItem(current, result.item));
      }
      return result.ok;
    },
    [bridge],
  );

  const forget = useCallback(
    async (memoryId: string) => {
      const result = await bridge.forgetMemory(memoryId);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setItems((current) => withoutItem(current, memoryId));
      }
      return result.ok;
    },
    [bridge],
  );

  return { items, limit, loaded, failure, add, edit, forget };
}
