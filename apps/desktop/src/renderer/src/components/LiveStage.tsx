import type { Device, TaskMove } from "@venom/contracts";
import { useEffect, useRef, useState } from "react";
import type { LivePhase, LiveQuality } from "../live-screen.ts";
import { moveLook } from "../move-words.ts";
import { button, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

export interface LiveStageProps {
  readonly device: Device | null;
  readonly phase: LivePhase;
  readonly stream: MediaStream | null;
  readonly quality: LiveQuality | null;
  readonly move: TaskMove | null;
  readonly onRetry: () => void;
}

function qualityWords(quality: LiveQuality | null): string | null {
  return quality === null ? null : `${quality.height}p · ${quality.fps} fps`;
}

function Corners() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-2.5 z-10">
      <span className="absolute top-0 left-0 h-4 w-4 rounded-tl-md border-t-2 border-l-2 border-green-400/70" />
      <span className="absolute top-0 right-0 h-4 w-4 rounded-tr-md border-t-2 border-r-2 border-green-400/70" />
      <span className="absolute bottom-0 left-0 h-4 w-4 rounded-bl-md border-b-2 border-l-2 border-green-400/70" />
      <span className="absolute right-0 bottom-0 h-4 w-4 rounded-br-md border-r-2 border-b-2 border-green-400/70" />
    </span>
  );
}

function Waiting({ phase, name, onRetry }: { readonly phase: LivePhase; readonly name: string; readonly onRetry: () => void }) {
  if (phase === "connecting") {
    return (
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <span className="relative grid h-16 w-16 place-items-center">
          <span className="absolute inset-0 animate-spin-slow rounded-full border-2 border-green-400/15 border-t-green-400/80" />
          <span className="absolute inset-2.5 animate-breathe rounded-full bg-green-400/10" />
          <Icon name="screen" className="relative h-6 w-6 text-green-300" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">Connecting to {name}</p>
          <p className={text.support}>The live screen opens in a moment.</p>
        </div>
      </div>
    );
  }
  if (phase === "offline") {
    return (
      <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
        <Icon name="devices" className="h-8 w-8 text-ink-faint" />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">{name} is asleep or switched off</p>
          <p className={text.support}>Nothing can wake a sleeping computer from far away. Open it and start VENOM, and the live screen comes back by itself.</p>
        </div>
      </div>
    );
  }
  if (phase === "locked") {
    return (
      <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full border border-status-wait/40 bg-status-wait/[0.08] shadow-[0_0_24px_-6px_rgba(242,196,109,0.7)]">
          <Icon name="lock" className="h-6 w-6 text-status-wait" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">{name} is locked</p>
          <p className={text.support}>Unlock it and VENOM carries on by itself. Windows lets no app unlock it from far away, so this part is yours.</p>
        </div>
      </div>
    );
  }
  if (phase === "lost") {
    return (
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <Icon name="wave" className="h-8 w-8 text-status-wait" />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">Ooh, the picture dropped</p>
          <p className={text.support}>I keep trying by myself, or you can try now.</p>
        </div>
        <button type="button" className={button.compact} onClick={onRetry}>
          <Icon name="retry" className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 px-6 text-center">
      <Icon name="screen" className="h-8 w-8 text-ink-faint" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-ink">No computer to watch yet</p>
        <p className={text.support}>When VENOM runs on a computer, its screen shows here live.</p>
      </div>
    </div>
  );
}

function Caption({ move, look }: { readonly move: TaskMove; readonly look: (typeof moveLook)[TaskMove["status"]] }) {
  return (
    <div className="glass-strong flex items-center gap-3 rounded-full py-2 pr-4 pl-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-green-400/15 text-[11px] font-semibold text-green-300 tabular-nums">{move.number}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{move.intent}</span>
      <Icon name={look.icon} className={`h-3.5 w-3.5 shrink-0 ${look.tone}`} />
    </div>
  );
}

export function LiveStage({ device, phase, stream, quality, move, onRetry }: LiveStageProps) {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [full, setFull] = useState(false);
  const live = phase === "live" && stream !== null;
  const name = device?.name ?? "the computer";
  const look = move === null ? null : moveLook[move.status];

  useEffect(() => {
    const element = video.current;
    if (element === null) {
      return;
    }
    element.srcObject = live ? stream : null;
    if (live) {
      void element.play().catch(() => undefined);
    }
  }, [live, stream]);

  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  function toggleFull() {
    if (document.fullscreenElement === stage.current) {
      void document.exitFullscreen();
      return;
    }
    void stage.current?.requestFullscreen().catch(() => undefined);
  }

  const words = qualityWords(quality);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        ref={stage}
        className={`relative isolate overflow-hidden bg-sunken ${full ? "grid h-full w-full place-items-center" : "rounded-overlay border border-green-400/25 shadow-glow"} ${live || full ? "" : "min-h-[300px] sm:min-h-0"}`}
      >
        <video
          ref={video}
          muted
          playsInline
          aria-label={`The screen of ${name}, live`}
          className={`block ${full ? "max-h-full max-w-full" : "aspect-video w-full"} object-contain ${live ? "" : "invisible"}`}
        />
        {!live && (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(31,242,92,0.07),transparent_65%)] pt-12 pb-4 sm:py-0">
            <Waiting phase={phase} name={name} onRetry={onRetry} />
          </div>
        )}
        <Corners />
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 sm:p-4">
          <div className="glass-strong flex min-w-0 items-center gap-2 rounded-full py-1 pr-3.5 pl-1">
            <span
              className={`hud flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] ${live ? "bg-green-400/15 text-green-300 shadow-[0_0_0_1px_rgba(77,255,124,0.45)]" : "bg-white/[0.06] text-ink-faint"}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-green-400 shadow-[0_0_8px_2px_rgba(31,242,92,0.8)]" : "bg-ink-faint"}`} />
              Live
            </span>
            <span className="truncate text-[11.5px] font-medium text-ink sm:text-[13px]">{name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {live && words !== null && <span className="hud glass-strong hidden rounded-full px-2.5 py-1.5 text-[10px] text-ink-muted tabular-nums sm:inline">{words}</span>}
            <button
              type="button"
              onClick={toggleFull}
              className="glass-strong grid h-7 w-7 place-items-center rounded-full text-ink-muted sm:h-8 sm:w-8 transition-colors duration-200 ease-ui hover:border-green-400/50 hover:text-green-300"
              aria-label={full ? "Leave full screen" : "Full screen"}
              title={full ? "Leave full screen" : "Full screen"}
            >
              <Icon name={full ? "cross" : "expand"} className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {live && move !== null && look !== null && (
          <div className={`absolute inset-x-4 bottom-4 z-10 ${full ? "block" : "hidden sm:block"}`} aria-live="polite">
            <Caption move={move} look={look} />
          </div>
        )}
      </div>
      {live && move !== null && look !== null && (
        <div className="sm:hidden" aria-live="polite">
          <Caption move={move} look={look} />
        </div>
      )}
    </div>
  );
}
