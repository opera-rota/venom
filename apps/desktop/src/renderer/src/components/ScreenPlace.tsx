import type { Device, Task, TaskMove, Thumbnail } from "@venom/contracts";
import { useEffect, useState } from "react";
import { moveLook, movesSoFar } from "../move-words.ts";
import { isOpen } from "../tasks-state.ts";
import { button, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { MoveList } from "./MoveList.tsx";
import { Place } from "./Place.tsx";
import { lookOfTask, routeTag } from "./StepList.tsx";

export interface ScreenPlaceProps {
  readonly task: Task | null;
  readonly moves: readonly TaskMove[];
  readonly loaded: boolean;
  readonly picture: Thumbnail | null;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly stopping: boolean;
  readonly onLoad: (taskId: string) => void;
  readonly onStop: (taskId: string) => void;
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return now;
}

function updatedWords(move: TaskMove | null, now: number): string | null {
  if (move === null) {
    return null;
  }
  const seconds = Math.max(0, Math.round((now - Date.parse(move.finished_at ?? move.created_at)) / 1000));
  if (seconds < 60) {
    return `updated ${seconds} s ago`;
  }
  const minutes = Math.round(seconds / 60);
  return `updated ${minutes} min ago`;
}

function deviceName(task: Task, devices: readonly Device[]): string {
  return devices.find((device) => device.id === task.target_device_id)?.name ?? "the computer";
}

export function ScreenPlace({ task, moves, loaded, picture, deviceId, devices, stopping, onLoad, onStop }: ScreenPlaceProps) {
  const taskId = task?.id ?? null;
  const open = task !== null && isOpen(task);
  const now = useNow(open);

  useEffect(() => {
    if (taskId !== null && !loaded) {
      onLoad(taskId);
    }
  }, [taskId, loaded, onLoad]);

  if (task === null) {
    return (
      <Place title="Screen" icon="screen">
        <div className={`flex flex-col items-center gap-2 px-6 py-14 text-center ${surface.card}`}>
          <Icon name="screen" className="h-8 w-8 text-ink-faint" />
          <p className="font-medium text-ink">Nothing is running</p>
          <p className={text.support}>When VENOM works, you will see the screen here.</p>
        </div>
      </Place>
    );
  }

  const look = lookOfTask(task);
  const latest = moves.at(-1) ?? null;
  const updated = updatedWords(latest, now);

  return (
    <Place title="Screen" icon="screen" width="wide">
      <div className="flex flex-col gap-1">
        <p className="break-words text-sm font-medium text-ink">{task.request_text}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${text.detail}`}>
            <span className={`flex items-center gap-1.5 ${look.tone}`}>
              <Icon name={look.icon} />
              <span>{look.word}</span>
            </span>
            <span className="tabular-nums text-ink-muted">· {movesSoFar(task, open)}</span>
            <span className="text-ink-faint">· {routeTag(task.target_device_id, deviceId, devices)}</span>
            {updated !== null && <span className="tabular-nums text-ink-faint">· {updated}</span>}
          </span>
          {open && (
            <button type="button" className={button.destructive} disabled={stopping} onClick={() => onStop(task.id)}>
              <Icon name="stop" className="h-3 w-3" />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-5 min-[960px]:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          {picture !== null ? (
            <img
              src={`data:image/jpeg;base64,${picture}`}
              alt={`What VENOM sees on ${deviceName(task, devices)}`}
              className="block h-auto w-full rounded-control border border-line bg-sunken"
            />
          ) : (
            <div className={`grid aspect-video place-items-center px-6 text-center ${surface.card}`}>
              <p className={text.support}>{open ? "Waiting for the first picture of the screen." : "No picture of this job is kept."}</p>
            </div>
          )}
          {open && latest !== null && (
            <p className="flex items-start gap-2 text-[13px] leading-normal text-ink" aria-live="polite">
              <Icon name={moveLook[latest.status].icon} className={`mt-1 h-3.5 w-3.5 shrink-0 ${moveLook[latest.status].tone}`} />
              <span className="min-w-0 break-words">{latest.intent}</span>
            </p>
          )}
        </div>
        <section aria-label="Moves" className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">Moves</h3>
          {moves.length > 0 ? (
            <MoveList moves={moves} />
          ) : (
            <p className={text.support}>{open ? (loaded ? "VENOM is looking at the screen." : "Getting VENOM's moves…") : "No moves were made."}</p>
          )}
          {!open && task.result !== null && <p className={`break-words ${text.support}`}>{task.result}</p>}
        </section>
      </div>
    </Place>
  );
}
