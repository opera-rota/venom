import type { Device, Task, TaskMove, Thumbnail } from "@venom/contracts";
import { useEffect } from "react";
import { moveLook, movesSoFar } from "../move-words.ts";
import { isOpen } from "../tasks-state.ts";
import { button, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { MoveList } from "./MoveList.tsx";
import { lookOfTask, routeTag } from "./StepList.tsx";

export interface JobCardProps {
  readonly task: Task | undefined;
  readonly moves: readonly TaskMove[];
  readonly loaded: boolean;
  readonly picture: Thumbnail | null;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly stopping: boolean;
  readonly onLoad: (taskId: string) => void;
  readonly onStop: (taskId: string) => void;
  readonly onContinue: (taskId: string) => void;
}

function deviceName(task: Task, devices: readonly Device[]): string {
  return devices.find((device) => device.id === task.target_device_id)?.name ?? "the computer";
}

export function JobCard({ task, moves, loaded, picture, deviceId, devices, stopping, onLoad, onStop, onContinue }: JobCardProps) {
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
  const latest = moves.at(-1) ?? null;
  const waiting = task.status === "awaiting_confirmation" && latest?.status !== "asking";
  return (
    <section aria-label="Job" className="relative mt-4 flex flex-col gap-4 overflow-hidden rounded-[20px] border border-green-400/20 bg-linear-to-br from-green-400/[0.07] via-black/30 to-black/40 p-4 shadow-[inset_0_1px_0_rgba(200,255,215,0.06)]">
      <svg viewBox="0 0 300 160" className="pointer-events-none absolute -right-10 -bottom-6 h-40 w-72 opacity-70" aria-hidden="true">
        <path d="M10 150 C80 140 120 110 160 80 S240 20 300 10" fill="none" stroke="#4dff7c" strokeOpacity="0.5" strokeWidth="1.2" style={{ filter: "drop-shadow(0 0 6px rgba(31,242,92,0.9))" }} />
        <path d="M40 160 C100 145 150 120 190 90 S260 40 300 35" fill="none" stroke="#8bffa8" strokeOpacity="0.25" strokeWidth="1" />
        <path d="M0 130 C70 125 110 100 150 70 S230 15 300 -5" fill="none" stroke="#1ff25c" strokeOpacity="0.2" strokeWidth="6" style={{ filter: "blur(4px)" }} />
      </svg>
      <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-green-400/35 bg-green-400/10 text-green-300 shadow-[0_0_20px_-6px_rgba(31,242,92,0.9)]">
            <Icon name="compass" className={`h-5 w-5 ${open ? "animate-spin-slow" : ""}`} />
          </span>
          <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${text.detail}`}>
            <span className={`flex items-center gap-1.5 ${look.tone}`}>
              <Icon name={look.icon} />
              <span>{look.word}</span>
            </span>
            <span className="tabular-nums text-ink-muted">· {movesSoFar(task, open)}</span>
            <span className="text-ink-faint">· {routeTag(task.target_device_id, deviceId, devices)}</span>
          </span>
        </span>
        {open && (
          <button type="button" className={button.destructive} disabled={stopping} onClick={() => onStop(task.id)}>
            <Icon name="stop" className="h-3 w-3" />
            {stopping ? "Stopping…" : "Stop"}
          </button>
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
      {open && latest !== null && (
        <p className="flex items-start gap-2 text-[13px] leading-normal text-ink" aria-live="polite">
          <Icon name={moveLook[latest.status].icon} className={`mt-1 h-3.5 w-3.5 shrink-0 ${moveLook[latest.status].tone}`} />
          <span className="min-w-0 break-words">{latest.intent}</span>
        </p>
      )}
      {picture !== null && (
        <figure className="relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-green-400/25 bg-sunken shadow-[0_0_30px_-12px_rgba(31,242,92,0.8)]">
          <img src={`data:image/jpeg;base64,${picture}`} alt={`What VENOM saw on ${deviceName(task, devices)}`} className="block h-auto w-full" />
          <figcaption className="hud absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[9px] text-green-300 backdrop-blur">
            <span className={`h-1.5 w-1.5 rounded-full ${open ? "animate-pulse bg-green-400" : "bg-ink-faint"}`} />
            {open ? "Last look" : "Final look"}
          </figcaption>
        </figure>
      )}
      {moves.length > 0 ? (
        <MoveList moves={moves} />
      ) : (
        open && <p className={text.support}>{loaded ? "VENOM is looking at the screen." : "Getting VENOM's moves…"}</p>
      )}
    </section>
  );
}
