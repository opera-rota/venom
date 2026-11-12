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
}

function deviceName(task: Task, devices: readonly Device[]): string {
  return devices.find((device) => device.id === task.target_device_id)?.name ?? "the computer";
}

export function JobCard({ task, moves, loaded, picture, deviceId, devices, stopping, onLoad, onStop }: JobCardProps) {
  const taskId = task?.id ?? null;

  useEffect(() => {
    if (taskId !== null && !loaded) {
      onLoad(taskId);
    }
  }, [taskId, loaded, onLoad]);

  if (task === undefined) {
    return <p className={`mt-3 border-t border-line-subtle pt-3 ${text.support}`}>This job is no longer among your recent tasks.</p>;
  }
  const open = isOpen(task);
  const look = lookOfTask(task);
  const latest = moves.at(-1) ?? null;
  return (
    <section aria-label="Job" className="mt-3 flex flex-col gap-3 border-t border-line-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${text.detail}`}>
          <span className={`flex items-center gap-1.5 ${look.tone}`}>
            <Icon name={look.icon} />
            <span>{look.word}</span>
          </span>
          <span className="tabular-nums text-ink-muted">· {movesSoFar(task, open)}</span>
          <span className="text-ink-faint">· {routeTag(task.target_device_id, deviceId, devices)}</span>
        </span>
        {open && (
          <button type="button" className={button.destructive} disabled={stopping} onClick={() => onStop(task.id)}>
            <Icon name="stop" className="h-3 w-3" />
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
      {open && latest !== null && (
        <p className="flex items-start gap-2 text-[13px] leading-normal text-ink" aria-live="polite">
          <Icon name={moveLook[latest.status].icon} className={`mt-1 h-3.5 w-3.5 shrink-0 ${moveLook[latest.status].tone}`} />
          <span className="min-w-0 break-words">{latest.intent}</span>
        </p>
      )}
      {picture !== null && (
        <img
          src={`data:image/jpeg;base64,${picture}`}
          alt={`What VENOM saw on ${deviceName(task, devices)}`}
          className="block h-auto w-full max-w-[480px] rounded-control border border-line bg-sunken"
        />
      )}
      {moves.length > 0 ? (
        <MoveList moves={moves} />
      ) : (
        open && <p className={text.support}>{loaded ? "VENOM is looking at the screen." : "Getting VENOM's moves…"}</p>
      )}
    </section>
  );
}
