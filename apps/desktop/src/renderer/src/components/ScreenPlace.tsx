import type { Device, Task, TaskMove, Thumbnail } from "@venom/contracts";
import { useEffect, useState } from "react";
import type { LiveScreen } from "../live-screen.ts";
import { movesSoFar } from "../move-words.ts";
import { isOpen } from "../tasks-state.ts";
import type { LaterState } from "../use-later.ts";
import { button, mark, surface, text } from "../ui.ts";
import { ForLater } from "./ForLater.tsx";
import { Icon } from "./Icon.tsx";
import { LiveStage } from "./LiveStage.tsx";
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
  readonly live: LiveScreen<MediaStream>;
  readonly stopping: boolean;
  readonly later: LaterState;
  readonly onLoad: (taskId: string) => void;
  readonly onStop: (taskId: string) => void;
  readonly onOpenLink: (url: string) => void;
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
  return `updated ${Math.round(seconds / 60)} min ago`;
}

function Sources({ live }: { readonly live: LiveScreen<MediaStream> }) {
  if (live.sources.length < 2) {
    return null;
  }
  return (
    <div role="radiogroup" aria-label="Which screen to watch" className="flex flex-wrap gap-2">
      {live.sources.map((source) => {
        const chosen = source.id === live.watching?.id;
        const online = source.status === "active";
        return (
          <button
            key={source.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={!online}
            onClick={() => live.watch(source.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ease-ui disabled:cursor-not-allowed disabled:text-ink-faint ${chosen ? "border-green-400/55 bg-green-400/[0.1] text-green-300 shadow-glow" : "border-line bg-white/[0.03] text-ink hover:border-green-400/40"}`}
          >
            <span className={`${mark.dot} ${online ? "bg-green-400" : "bg-status-idle"}`} />
            {source.name}
          </button>
        );
      })}
    </div>
  );
}

function Picture({ picture, open, name }: { readonly picture: Thumbnail | null; readonly open: boolean; readonly name: string }) {
  if (picture !== null) {
    return <img src={`data:image/jpeg;base64,${picture}`} alt={`What VENOM sees on ${name}`} className="block h-auto w-full rounded-overlay border border-line bg-sunken" />;
  }
  return (
    <div className={`grid aspect-video place-items-center px-6 text-center ${surface.card}`}>
      <p className={text.support}>{open ? "Waiting for the first picture of the screen." : "No picture of this job is kept."}</p>
    </div>
  );
}

function Job({ task, moves, loaded, devices, deviceId, stopping, onStop }: Pick<ScreenPlaceProps, "moves" | "loaded" | "devices" | "deviceId" | "stopping" | "onStop"> & { readonly task: Task }) {
  const open = isOpen(task);
  const now = useNow(open);
  const look = lookOfTask(task);
  const updated = updatedWords(moves.at(-1) ?? null, now);

  return (
    <div className="grid content-start gap-4 min-[960px]:max-[1279px]:grid-cols-2">
      <section aria-label="The job" className={`flex min-w-0 flex-col gap-3 p-4 ${open ? surface.cardActive : surface.card}`}>
        <span className={text.eyebrow + " text-[9.5px]"}>{open ? "Working on" : "Last job"}</span>
        <p className="break-words text-[15px] leading-snug font-medium text-ink">{task.request_text}</p>
        <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${text.detail}`}>
          <span className={`flex items-center gap-1.5 ${look.tone}`}>
            <Icon name={look.icon} />
            <span>{look.word}</span>
          </span>
          <span className="tabular-nums text-ink-muted">· {movesSoFar(task, open)}</span>
          <span className="text-ink-faint">· {routeTag(task.target_device_id, deviceId, devices)}</span>
          {updated !== null && <span className="tabular-nums text-ink-faint">· {updated}</span>}
        </span>
        {!open && task.result !== null && <p className={`break-words ${text.support}`}>{task.result}</p>}
        {open && (
          <div className="mt-1 flex">
            <button type="button" className={button.destructive} disabled={stopping} onClick={() => onStop(task.id)}>
              <Icon name="stop" className="h-3 w-3" />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          </div>
        )}
      </section>
      <section aria-label="Moves" className={`flex min-w-0 flex-col gap-3 p-4 ${surface.card}`}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="list" className="h-3.5 w-3.5 text-green-300" />
          Moves
        </h3>
        {moves.length > 0 ? (
          <MoveList moves={moves} />
        ) : (
          <p className={text.support}>{open ? (loaded ? "VENOM is looking at the screen." : "Getting VENOM's moves…") : "No moves were made."}</p>
        )}
      </section>
    </div>
  );
}

function Unwatchable({ computer }: { readonly computer: boolean }) {
  return (
    <div className={`grid aspect-video place-items-center px-6 text-center ${surface.card}`}>
      <div className="flex max-w-sm flex-col items-center gap-3">
        <Icon name={computer ? "eye" : "screen"} className="h-8 w-8 text-green-300/70" />
        <p className="font-medium text-ink">{computer ? "This computer is the one VENOM works on" : "No computer to watch yet"}</p>
        <p className={text.support}>
          {computer ? "Open VENOM on your phone and choose Screen to watch it live from anywhere." : "When VENOM runs on one of your computers, its screen shows here live."}
        </p>
      </div>
    </div>
  );
}

function Resting() {
  return (
    <div className={`flex h-fit items-center gap-3 px-4 py-3.5 ${surface.card}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-green-400/10">
        <Icon name="sparkle" className="h-4 w-4 text-green-300" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium text-ink">VENOM is resting</p>
        <p className={text.support}>Ask for something in Chat and watch VENOM do it here, live.</p>
      </div>
    </div>
  );
}

export function ScreenPlace({ task, moves, loaded, picture, deviceId, devices, live, stopping, later, onLoad, onStop, onOpenLink }: ScreenPlaceProps) {
  const taskId = task?.id ?? null;
  const open = task !== null && isOpen(task);
  const target = task?.target_device_id ?? null;
  const watchingJob = open && live.watching !== null && live.watching.id === target;
  const showLive = live.sources.length > 0 && (task === null || target !== deviceId || !open);
  const self = devices.find((device) => device.id === deviceId) ?? null;

  useEffect(() => {
    if (taskId !== null && !loaded) {
      onLoad(taskId);
    }
  }, [taskId, loaded, onLoad]);

  return (
    <Place title="Screen" eyebrow="Live view" icon="screen" width="full">
      <Sources live={live} />
      <div className="grid gap-4 min-[1280px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3">
          {showLive ? (
            <LiveStage device={live.watching} phase={live.phase} stream={live.stream} quality={live.quality} move={watchingJob ? (moves.at(-1) ?? null) : null} onRetry={live.retry} />
          ) : task !== null ? (
            <Picture picture={picture} open={open} name={devices.find((device) => device.id === target)?.name ?? "the computer"} />
          ) : (
            <Unwatchable computer={self?.type === "computer"} />
          )}
        </div>
        {task === null ? (
          <Resting />
        ) : (
          <Job task={task} moves={moves} loaded={loaded} devices={devices} deviceId={deviceId} stopping={stopping} onStop={onStop} />
        )}
      </div>
      <div className="mt-2 border-t border-line-subtle pt-5">
        <ForLater state={later} onOpenLink={onOpenLink} />
      </div>
    </Place>
  );
}
