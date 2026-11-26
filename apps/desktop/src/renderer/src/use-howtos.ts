import { howToLimits, type ChangeHowTo, type HowTo } from "@venom/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";
import { applyHowToEvent, withHowTo, withoutHowTo } from "./howtos-state.ts";

export interface HowTosState {
  readonly howtos: readonly HowTo[];
  readonly limit: number;
  readonly loaded: boolean;
  readonly failure: string | null;
  readonly saving: ReadonlySet<string>;
  readonly applying: ReadonlySet<string>;
  save(taskId: string): Promise<HowTo | null>;
  change(howtoId: string, change: ChangeHowTo): Promise<boolean>;
  note(howtoId: string, number: number, note: string | null): Promise<boolean>;
  forget(howtoId: string): Promise<boolean>;
  apply(howtoId: string, stepByStep: boolean): Promise<boolean>;
}

function adding(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(current).add(id);
}

function removing(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  next.delete(id);
  return next;
}

export function useHowTos(bridge: VenomBridge, connection: ConnectionState): HowTosState {
  const [howtos, setHowTos] = useState<readonly HowTo[]>([]);
  const [limit, setLimit] = useState<number>(howToLimits.items);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    const stop = bridge.onEvent((event) => {
      if (active) {
        setHowTos((current) => applyHowToEvent(current, event));
      }
    });
    if (connection === "online") {
      void bridge.howtos().then((result) => {
        if (!active) {
          return;
        }
        if (result.ok) {
          setHowTos(result.list.howtos);
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

  const save = useCallback(
    async (taskId: string) => {
      setSaving((current) => adding(current, taskId));
      const result = await bridge.saveHowTo(taskId);
      setSaving((current) => removing(current, taskId));
      setFailure(result.ok ? null : result.reason);
      if (!result.ok) {
        return null;
      }
      setHowTos((current) => withHowTo(current, result.howto));
      return result.howto;
    },
    [bridge],
  );

  const change = useCallback(
    async (howtoId: string, update: ChangeHowTo) => {
      const result = await bridge.changeHowTo(howtoId, update);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setHowTos((current) => withHowTo(current, result.howto));
      }
      return result.ok;
    },
    [bridge],
  );

  const note = useCallback(
    async (howtoId: string, number: number, text: string | null) => {
      const result = await bridge.noteHowTo(howtoId, number, text);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setHowTos((current) => withHowTo(current, result.howto));
      }
      return result.ok;
    },
    [bridge],
  );

  const forget = useCallback(
    async (howtoId: string) => {
      const result = await bridge.forgetHowTo(howtoId);
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setHowTos((current) => withoutHowTo(current, howtoId));
      }
      return result.ok;
    },
    [bridge],
  );

  const apply = useCallback(
    async (howtoId: string, stepByStep: boolean) => {
      setApplying((current) => adding(current, howtoId));
      const result = await bridge.applyHowTo(howtoId, stepByStep);
      setApplying((current) => removing(current, howtoId));
      setFailure(result.ok ? null : result.reason);
      if (result.ok) {
        setHowTos((current) => withHowTo(current, result.howto));
      }
      return result.ok;
    },
    [bridge],
  );

  return { howtos, limit, loaded, failure, saving, applying, save, change, note, forget, apply };
}
