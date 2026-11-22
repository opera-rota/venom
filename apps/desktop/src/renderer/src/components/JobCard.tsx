import type { Device, Task, TaskMove } from "@venom/contracts";
import { useEffect } from "react";
import { movesSoFar } from "../move-words.ts";
import { isOpen } from "../tasks-state.ts";
import { button, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { lookOfTask, routeTag } from "./StepList.tsx";

export interface JobCardProps {
  readonly task: Task | undefined;
  readonly moves: readonly TaskMove[];
  readonly loaded: boolean;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly stopping: boolean;
  readonly onLoad: (taskId: string) => void;
  readonly onStop: (taskId: string) => void;
  readonly onContinue: (taskId: string) => void;
  readonly onWatch: () => void;
}

function headline(task: Task, open: boolean, waiting: boolean, asking: boolean): string {
  if (asking) {
    return "Waiting for your answer";
  }
  if (waiting) {
    return "Waiting for you";
  }
  return open ? "Working on it" : lookOfTask(task).word;
}

export function JobCard({ task, moves, loaded, deviceId, devices, stopping, onLoad, onStop, onContinue, onWatch }: JobCardProps) {
  const taskId = task?.id ?? null;

  useEffect(() => {
    if (taskId !== null && !loaded) {
      onLoad(taskId);
    }
  }, [taskId, loaded, onLoad]);

  if (task === undefined) {
    return <p className={`mt-3 ${text.support}`}>This job is no longer among your recent tasks.</p>;
  }
  const open = isOpen(task);
  const look = lookOfTask(task);
  const asking = task.status === "awaiting_confirmation" && moves.at(-1)?.status === "asking";
  const waiting = task.status === "awaiting_confirmation" && !asking;
  const working = open && !waiting && !asking;

  return (
    <section
      aria-label="Job"
      className={`mt-3 flex flex-col gap-3 rounded-2xl border px-3.5 py-3 ${open ? "border-green-400/30 bg-green-400/[0.06] shadow-[0_0_24px_-12px_rgba(31,242,92,0.8)]" : "border-line bg-white/[0.02]"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full border ${open ? "border-green-400/40 bg-green-400/10 text-green-300" : "border-line bg-white/[0.03]"} ${open ? "" : look.tone}`}
          >
            {working && <span className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-t-green-400/80" />}
            <Icon name={working ? "compass" : look.icon} className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5" aria-live="polite">
            <span className={`text-sm font-medium ${open ? "text-ink" : look.tone}`}>{headline(task, open, waiting, asking)}</span>
            <span className={`${text.detail} truncate text-ink-faint`}>
              {routeTag(task.target_device_id, deviceId, devices)} · {movesSoFar(task, open)}
            </span>
          </span>
        </span>
        {open && (
          <span className="flex shrink-0 items-center gap-2">
            <button type="button" className={button.compact} onClick={onWatch}>
              <Icon name="screen" className="h-3.5 w-3.5" />
              Watch live
            </button>
            <button type="button" className={button.destructive} disabled={stopping} onClick={() => onStop(task.id)}>
              <Icon name="stop" className="h-3 w-3" />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          </span>
        )}
      </div>
      {waiting && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="VENOM is waiting for you">
          <button type="button" className={button.gateApprove} disabled={stopping} onClick={() => onContinue(task.id)}>
            <Icon name="check" className="h-3.5 w-3.5 text-status-ok" />
            <span>Continue</span>
          </button>
          <button type="button" className={button.gateCancel} disabled={stopping} onClick={() => onStop(task.id)}>
            <Icon name="cross" className="h-3.5 w-3.5" />
            <span>{stopping ? "Leaving it…" : "Leave it"}</span>
          </button>
          <span className={`${text.detail} text-ink-faint`}>or type continue or leave it</span>
        </div>
      )}
    </section>
  );
}
