import type { ConfirmationStrictness, ConfirmDecision, ConfirmRequest, DrillKind, TaskControl } from "@venom/contracts";
import { useCallback, useEffect, useReducer, useState } from "react";
import type { ConnectionState, HaltView, VenomBridge } from "../../shared/bridge.ts";
import { initialTasks, isSafetyEvent, reduceTasks, type TasksState } from "./tasks-state.ts";

export interface TasksHandle {
  readonly state: TasksState;
  readonly halt: HaltView;
  readonly sending: ReadonlySet<string>;
  readonly controlling: ReadonlySet<string>;
  readonly failure: string | null;
  readonly strictness: ConfirmationStrictness | null;
  readonly saving: boolean;
  stop(): void;
  drill(kind: DrillKind): Promise<boolean>;
  answer(request: ConfirmRequest, decision: ConfirmDecision): Promise<void>;
  control(taskId: string, control: TaskControl): Promise<boolean>;
  stopTask(taskId: string): Promise<void>;
  dismiss(taskId: string): void;
  seen(stepId: string): void;
  choose(strictness: ConfirmationStrictness): Promise<void>;
  clearFailure(): void;
}

export function controlKey(taskId: string, kind: TaskControl["kind"] | "stop", stepId: string | null = null): string {
  return `${taskId}:${kind}:${stepId ?? ""}`;
}

function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

export function useTasks(bridge: VenomBridge, connection: ConnectionState): TasksHandle {
  const [state, dispatch] = useReducer(reduceTasks, initialTasks);
  const [halt, setHalt] = useState<HaltView>({ kind: "idle" });
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [controlling, setControlling] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const [strictness, setStrictness] = useState<ConfirmationStrictness | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void bridge.halt().then((view) => active && setHalt(view));
    const stopHalt = bridge.onHalt((view) => active && setHalt(view));
    const stopEvents = bridge.onEvent((event) => {
      if (active && isSafetyEvent(event)) {
        dispatch({ type: "event", event });
        if (event.type === "confirmation" && event.answered !== null) {
          setSending((current) => {
            const next = new Set(current);
            next.delete(event.request.step_id);
            return next;
          });
        }
      }
    });
    if (connection === "online") {
      void bridge.tasks().then((result) => {
        if (!active) {
          return;
        }
        if (result.ok) {
          dispatch({ type: "list", list: result.list });
        } else {
          setFailure(result.reason);
        }
      });
      void bridge.safety().then((result) => active && result.ok && setStrictness(result.settings.confirmation_strictness));
    }
    return () => {
      active = false;
      stopHalt();
      stopEvents();
    };
  }, [bridge, connection]);

  const stop = useCallback(() => void bridge.stop(), [bridge]);

  const drill = useCallback(
    async (kind: DrillKind) => {
      const result = await bridge.drill(kind);
      setFailure(result.ok ? null : result.reason);
      return result.ok;
    },
    [bridge],
  );

  const answer = useCallback(
    async (request: ConfirmRequest, decision: ConfirmDecision) => {
      setSending((current) => new Set(current).add(request.step_id));
      const result = await bridge.confirm(request.task_id, request.step_id, decision);
      if (!result.ok) {
        setFailure(result.reason);
        setSending((current) => {
          const next = new Set(current);
          next.delete(request.step_id);
          return next;
        });
      }
    },
    [bridge],
  );

  const control = useCallback(
    async (taskId: string, next: TaskControl) => {
      const key = controlKey(taskId, next.kind, "step_id" in next ? next.step_id : null);
      setControlling((current) => new Set(current).add(key));
      const result = await bridge.taskControl(taskId, next);
      setControlling((current) => without(current, key));
      if (result.ok) {
        dispatch({ type: "task", task: result.task });
      }
      setFailure(result.ok ? null : result.reason);
      return result.ok;
    },
    [bridge],
  );

  const stopTask = useCallback(
    async (taskId: string) => {
      const key = controlKey(taskId, "stop");
      setControlling((current) => new Set(current).add(key));
      const result = await bridge.stopTask(taskId);
      setControlling((current) => without(current, key));
      if (result.ok) {
        for (const task of result.receipt.tasks) {
          dispatch({ type: "task", task });
        }
      }
      setFailure(result.ok ? null : result.reason);
    },
    [bridge],
  );

  const choose = useCallback(
    async (next: ConfirmationStrictness) => {
      setSaving(true);
      const result = await bridge.setSafety(next);
      setSaving(false);
      if (result.ok) {
        setStrictness(result.settings.confirmation_strictness);
      }
      setFailure(result.ok ? null : result.reason);
    },
    [bridge],
  );

  return {
    state,
    halt,
    sending,
    controlling,
    failure,
    strictness,
    saving,
    stop,
    drill,
    answer,
    control,
    stopTask,
    choose,
    dismiss: (taskId) => dispatch({ type: "dismiss", taskId }),
    seen: (stepId) => dispatch({ type: "seen", stepId }),
    clearFailure: () => setFailure(null),
  };
}
