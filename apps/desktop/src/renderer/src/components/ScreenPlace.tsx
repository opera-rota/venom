import type { Device, HowTo, Task, TaskMove, TaskStatus, Thumbnail } from "@venom/contracts";
import { useEffect, useState } from "react";
import { deviceInUse, workers, type LiveScreen } from "../live-screen.ts";
import type { RemoteControl } from "../remote.ts";
import { lastedWords, sinceWords } from "../move-words.ts";
import { isOpen } from "../tasks-state.ts";
import type { LaterState } from "../use-later.ts";
import { button, mark, surface, text } from "../ui.ts";
import { ForLater } from "./ForLater.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { LiveStage } from "./LiveStage.tsx";
import { MoveList } from "./MoveList.tsx";
import { Place } from "./Place.tsx";

export interface ScreenPlaceProps {
  readonly task: Task | null;
  readonly moves: readonly TaskMove[];
  readonly loaded: boolean;
  readonly picture: Thumbnail | null;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly live: LiveScreen<MediaStream>;
  readonly remote: RemoteControl;
  readonly watched: boolean;
  readonly using: string | null;
  readonly stopping: boolean;
  readonly later: LaterState;
  readonly howto: HowTo | null;
  readonly savingHowTo: boolean;
  readonly onSaveHowTo: (taskId: string) => void;
  readonly onUse: (deviceId: string) => void;
  readonly onDevices: () => void;
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

function stateWords(device: Device): { readonly label: string; readonly dot: string; readonly tone: string } {
  if (device.status !== "active") {
    return { label: "Asleep or off", dot: "bg-status-idle", tone: "text-ink-muted" };
  }
  if (device.locked) {
    return { label: "Locked", dot: "bg-status-wait", tone: "text-status-wait" };
  }
  return { label: "Awake", dot: "bg-green-400 shadow-[0_0_8px_2px_rgba(31,242,92,0.7)]", tone: "text-green-300" };
}

function InUse({ device, self, onDevices }: { readonly device: Device; readonly self: boolean; readonly onDevices: () => void }) {
  const state = stateWords(device);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className={`flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 ${text.detail}`}>
        <span className="hud inline-flex items-center gap-1.5 rounded-full bg-green-400/15 px-2.5 py-1 text-[9.5px] text-green-300 shadow-[0_0_0_1px_rgba(77,255,124,0.5)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
          In use
        </span>
        <span className="truncate text-sm font-medium text-ink">{device.name}</span>
        {self && <span className={mark.tag}>This device</span>}
        <span className={`flex items-center gap-1.5 ${state.tone}`}>
          <span className={`${mark.dot} ${state.dot}`} />
          {state.label}
        </span>
      </div>
      <button type="button" className={button.mini} onClick={onDevices}>
        <Icon name="devices" className="h-3 w-3" />
        Change device
      </button>
    </div>
  );
}

function Choose({ devices, deviceId, using, onUse }: { readonly devices: readonly Device[]; readonly deviceId: string; readonly using: string | null; readonly onUse: (deviceId: string) => void }) {
  const choices = workers(devices);
  return (
    <div className={`flex flex-col gap-4 p-5 ${surface.cardActive}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-green-400/10">
          <Icon name="screen" className="h-5 w-5 text-green-300" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-ink">Choose the device VENOM works on</p>
          <p className={text.support}>It stays on Screen, live, and every job goes there. You can change it any time in Devices.</p>
        </div>
      </div>
      {choices.length === 0 ? (
        <p className={text.support}>Start VENOM on one of your computers to see it here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {choices.map((device) => {
            const online = device.status === "active";
            return (
              <li key={device.id} className="flex items-center justify-between gap-3 rounded-control border border-line bg-black/20 px-3.5 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className={`${mark.dot} ${online ? "bg-green-400" : "bg-status-idle"}`} />
                  <span className="truncate text-sm text-ink">{device.name}</span>
                  {device.id === deviceId && <span className={mark.tag}>This device</span>}
                </span>
                <button type="button" className={button.compact} disabled={using !== null} onClick={() => onUse(device.id)}>
                  <Icon name="bolt" className="h-3.5 w-3.5" />
                  {using === device.id ? "Choosing…" : (
                    <>
                      <span className="sm:hidden">Use</span>
                      <span className="hidden sm:inline">Use this device</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Here({ device, watched }: { readonly device: Device; readonly watched: boolean }) {
  return (
    <div className={`grid aspect-video place-items-center px-6 text-center ${surface.card}`}>
      <div className="flex max-w-md flex-col items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-full border border-green-400/35 bg-green-400/10 shadow-mark">
          <Icon name={watched ? "eye" : "screen"} className="h-6 w-6 text-green-300" />
        </span>
        <p className="font-medium text-ink">VENOM works right here, on {device.name}</p>
        <p className={text.support}>
          {watched
            ? "Someone is watching this screen live from another device."
            : "VENOM keeps this computer awake while it is in use. Open Screen on your phone to watch it live from anywhere."}
        </p>
      </div>
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

const jobLook: Record<TaskStatus, { readonly word: string; readonly icon: IconName; readonly tone: string; readonly orb: string }> = {
  created: { word: "Starting", icon: "sparkle", tone: "text-green-300", orb: "border-green-400/50 bg-green-400/10 text-green-300" },
  planned: { word: "Starting", icon: "sparkle", tone: "text-green-300", orb: "border-green-400/50 bg-green-400/10 text-green-300" },
  running: { word: "Working", icon: "pulse", tone: "text-green-300", orb: "ring-live border-green-400/60 bg-green-400/15 text-green-300" },
  awaiting_confirmation: { word: "Needs you", icon: "hourglass", tone: "text-status-wait", orb: "border-status-wait/60 bg-status-wait/10 text-status-wait" },
  completed: { word: "Done", icon: "check", tone: "text-status-ok", orb: "border-green-400/50 bg-green-400/10 text-status-ok" },
  failed: { word: "Did not finish", icon: "pause", tone: "text-status-wait", orb: "border-status-wait/45 bg-status-wait/[0.08] text-status-wait" },
  cancelled: { word: "Stopped", icon: "stop", tone: "text-ink-muted", orb: "border-line-strong bg-white/[0.04] text-ink-muted" },
  stopped: { word: "Stopped", icon: "stop", tone: "text-ink-muted", orb: "border-line-strong bg-white/[0.04] text-ink-muted" },
};

function Stat({ icon, label, value }: { readonly icon: IconName; readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[12px] border border-line-subtle bg-black/30 px-3 py-2.5">
      <span className="hud flex items-center gap-1.5 text-[9px] text-ink-faint">
        <Icon name={icon} className="h-3 w-3 text-green-300/70" />
        {label}
      </span>
      <span className="tabular truncate text-[13px] font-semibold text-ink">{value}</span>
    </div>
  );
}

function Job({ task, moves, loaded, devices, deviceId, stopping, howto, savingHowTo, onStop, onSaveHowTo }: Pick<ScreenPlaceProps, "moves" | "loaded" | "devices" | "deviceId" | "stopping" | "howto" | "savingHowTo" | "onStop" | "onSaveHowTo"> & { readonly task: Task }) {
  const open = isOpen(task);
  const now = useNow(open);
  const look = jobLook[task.status];
  const [whole, setWhole] = useState(false);
  const target = devices.find((device) => device.id === task.target_device_id) ?? null;
  const where = target === null ? "No device" : target.id === deviceId ? "This one" : target.name.replace(/\s*\(.*\)\s*$/u, "");

  return (
    <section aria-label={open ? "Working on" : "Last job"} className={`flex h-fit min-w-0 flex-col gap-4 p-5 ${open ? surface.cardActive : surface.card}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <span className={`grid h-8 w-8 place-items-center rounded-full border ${look.orb}`}>
            <Icon name={look.icon} className="h-3.5 w-3.5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="hud text-[9px] text-ink-faint">{open ? "Working on" : "Last job"}</span>
            <span className={`text-[13px] font-semibold ${look.tone}`}>{look.word}</span>
          </span>
        </span>
        <span className="tabular text-[11px] text-ink-faint">{sinceWords(task.updated_at, now)}</span>
      </div>
      <button type="button" onClick={() => setWhole((shown) => !shown)} aria-expanded={whole} className={`text-left break-words text-[15px] leading-snug font-semibold text-ink first-letter:uppercase ${whole ? "" : "line-clamp-2"}`}>
        {task.request_text}
      </button>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
        <Stat icon="list" label="Moves" value={String(task.moves)} />
        <Stat icon="laptop" label="Device" value={where} />
        <Stat icon="hourglass" label={open ? "So far" : "Took"} value={lastedWords(task)} />
      </div>
      {!open && task.result !== null && (
        <button type="button" onClick={() => setWhole((shown) => !shown)} className={`text-left text-[12.5px] leading-normal text-ink-muted ${whole ? "" : "line-clamp-2"}`}>
          {task.result}
        </button>
      )}
      {task.status === "completed" && task.moves > 0 &&
        (howto === null ? (
          <button type="button" disabled={savingHowTo} onClick={() => onSaveHowTo(task.id)} className={`${button.compact} self-start`}>
            <Icon name="sparkle" className="h-3.5 w-3.5 text-green-300" />
            {savingHowTo ? "Saving…" : "Save as how-to"}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 self-start rounded-full border border-green-400/30 bg-green-400/[0.08] px-3 py-1.5 text-[12px] font-medium text-green-300">
            <Icon name="check" className="h-3.5 w-3.5" />
            Saved as a how-to in Memory
          </span>
        ))}
      {open && (
        <button type="button" className={`${button.destructive} self-start`} disabled={stopping} onClick={() => onStop(task.id)}>
          <Icon name="stop" className="h-3 w-3" />
          {stopping ? "Stopping…" : "Stop"}
        </button>
      )}
      <div className={mark.divider} />
      <div className="flex flex-col gap-3">
        <span className="hud flex items-center justify-between text-[9.5px] text-ink-faint">
          <span>Moves</span>
          {moves.length > 0 && <span className="text-green-300/70">Tap one to see why</span>}
        </span>
        {moves.length > 0 ? (
          <MoveList moves={moves} />
        ) : (
          <p className={text.support}>{open ? (loaded ? "Looking at the screen…" : "Loading moves…") : "No moves were made."}</p>
        )}
      </div>
    </section>
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

export function ScreenPlace({ task, moves, loaded, picture, deviceId, devices, live, remote, watched, using, stopping, later, howto, savingHowTo, onUse, onDevices, onLoad, onStop, onSaveHowTo, onOpenLink }: ScreenPlaceProps) {
  const taskId = task?.id ?? null;
  const open = task !== null && isOpen(task);
  const chosen = deviceInUse(devices);
  const here = chosen !== null && chosen.id === deviceId;
  const elsewhere = open && task.target_device_id !== null && task.target_device_id !== chosen?.id;
  const watchingJob = open && live.watching !== null && live.watching.id === task.target_device_id;

  useEffect(() => {
    if (taskId !== null && !loaded) {
      onLoad(taskId);
    }
  }, [taskId, loaded, onLoad]);

  function stage() {
    if (chosen === null) {
      return elsewhere ? <Picture picture={picture} open={open} name={devices.find((device) => device.id === task?.target_device_id)?.name ?? "the computer"} /> : <Choose devices={devices} deviceId={deviceId} using={using} onUse={onUse} />;
    }
    if (here) {
      return <Here device={chosen} watched={watched} />;
    }
    return <LiveStage device={live.watching} phase={live.phase} stream={live.stream} quality={live.quality} move={watchingJob ? (moves.at(-1) ?? null) : null} remote={remote} onRetry={live.retry} />;
  }

  return (
    <Place title="Screen" eyebrow="Live view" icon="screen" width="full">
      {chosen !== null && <InUse device={chosen} self={here} onDevices={onDevices} />}
      <div className="grid gap-4 min-[1280px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-3">{stage()}</div>
        {task === null ? (
          <Resting />
        ) : (
          <Job task={task} moves={moves} loaded={loaded} devices={devices} deviceId={deviceId} stopping={stopping} howto={howto} savingHowTo={savingHowTo} onStop={onStop} onSaveHowTo={onSaveHowTo} />
        )}
      </div>
      <div className="mt-2 border-t border-line-subtle pt-5">
        <ForLater state={later} onOpenLink={onOpenLink} />
      </div>
    </Place>
  );
}
