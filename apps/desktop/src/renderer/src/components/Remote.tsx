import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import { gesture, pictureBox, remoteKeys, scrollSteps, spotIn, type RemoteAction, type RemoteControl, type RemoteSpot, type RemoteTouchKind } from "../remote.ts";
import { Icon } from "./Icon.tsx";

interface Ring {
  readonly id: number;
  readonly left: number;
  readonly top: number;
  readonly kind: RemoteTouchKind | "scroll";
}

interface Press {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  moved: boolean;
  held: boolean;
}

const ringTone: Record<Ring["kind"], string> = {
  click: "border-green-300 shadow-[0_0_18px_4px_rgba(31,242,92,0.55)]",
  double: "border-green-200 shadow-[0_0_22px_6px_rgba(31,242,92,0.7)]",
  right: "border-status-wait shadow-[0_0_18px_4px_rgba(242,196,109,0.55)]",
  scroll: "border-green-400/70 shadow-[0_0_14px_2px_rgba(31,242,92,0.4)]",
};

export function RemoteSwitch({ remote }: { readonly remote: RemoteControl }) {
  if (!remote.ready) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={remote.toggle}
      aria-pressed={remote.on}
      title={remote.on ? "Hand the computer back" : "Take control"}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold transition-[background-color,box-shadow,color] duration-200 ease-ui sm:h-8 sm:px-3 sm:text-[12.5px] ${
        remote.on
          ? "bg-linear-to-b from-green-400 to-green-600 text-on-accent shadow-[0_0_0_1px_rgba(77,255,124,0.7),0_0_22px_-2px_rgba(31,242,92,0.85)]"
          : "glass-strong text-ink-muted hover:border-green-400/50 hover:text-green-300"
      }`}
    >
      <Icon name="tap" className="h-3.5 w-3.5" />
      Remote
    </button>
  );
}

export function RemoteLayer({ video, onAction }: { readonly video: RefObject<HTMLVideoElement | null>; readonly onAction: (action: RemoteAction) => void }) {
  const layer = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const hold = useRef<number | null>(null);
  const single = useRef<{ readonly timer: number; readonly x: number; readonly y: number } | null>(null);
  const counter = useRef(0);
  const [rings, setRings] = useState<readonly Ring[]>([]);

  useEffect(
    () => () => {
      if (hold.current !== null) {
        window.clearTimeout(hold.current);
      }
      if (single.current !== null) {
        window.clearTimeout(single.current.timer);
      }
    },
    [],
  );

  function spotAt(clientX: number, clientY: number): RemoteSpot | null {
    const element = video.current;
    if (element === null) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return spotIn(pictureBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, element.videoWidth, element.videoHeight), clientX, clientY);
  }

  function ring(clientX: number, clientY: number, kind: Ring["kind"]) {
    const box = layer.current?.getBoundingClientRect();
    if (box === undefined) {
      return;
    }
    counter.current += 1;
    const next: Ring = { id: counter.current, left: clientX - box.left, top: clientY - box.top, kind };
    setRings((current) => [...current.slice(-5), next]);
    window.setTimeout(() => setRings((current) => current.filter((item) => item.id !== next.id)), 950);
  }

  function touch(kind: RemoteTouchKind, clientX: number, clientY: number) {
    const spot = spotAt(clientX, clientY);
    if (spot === null) {
      return;
    }
    ring(clientX, clientY, kind);
    onAction({ kind, spot });
  }

  function clearHold() {
    if (hold.current !== null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const started: Press = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, held: false };
    press.current = started;
    clearHold();
    hold.current = window.setTimeout(() => {
      if (press.current === started && !started.moved) {
        started.held = true;
        touch("right", started.x, started.y);
      }
    }, gesture.holdMs);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const started = press.current;
    if (started === null || started.pointer !== event.pointerId || started.moved) {
      return;
    }
    if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > gesture.slop) {
      started.moved = true;
      clearHold();
    }
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const started = press.current;
    press.current = null;
    clearHold();
    if (started === null || started.pointer !== event.pointerId || started.held) {
      return;
    }
    if (started.moved) {
      const scroll = scrollSteps(event.clientY - started.y);
      const spot = spotAt(started.x, started.y);
      if (scroll !== null && spot !== null) {
        ring(started.x, started.y, "scroll");
        onAction({ kind: "scroll", spot, ...scroll });
      }
      return;
    }
    const waiting = single.current;
    if (waiting !== null && Math.hypot(event.clientX - waiting.x, event.clientY - waiting.y) <= gesture.slop * 2) {
      window.clearTimeout(waiting.timer);
      single.current = null;
      touch("double", waiting.x, waiting.y);
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    single.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        single.current = null;
        touch("click", x, y);
      }, gesture.doubleMs),
    };
  }

  function wheel(event: ReactWheelEvent<HTMLDivElement>) {
    const spot = spotAt(event.clientX, event.clientY);
    if (spot === null || event.deltaY === 0) {
      return;
    }
    onAction({ kind: "scroll", spot, direction: event.deltaY > 0 ? "down" : "up", steps: Math.min(3, Math.max(1, Math.round(Math.abs(event.deltaY) / 100))) });
  }

  return (
    <div
      ref={layer}
      role="application"
      aria-label="Remote control of the live screen"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        press.current = null;
        clearHold();
      }}
      onWheel={wheel}
      onContextMenu={(event) => {
        event.preventDefault();
        touch("right", event.clientX, event.clientY);
      }}
      className="absolute inset-0 z-[5] cursor-crosshair touch-none select-none"
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2px_rgba(77,255,124,0.55),inset_0_0_42px_-6px_rgba(31,242,92,0.45)]" />
      {rings.map((item) => (
        <span key={item.id} aria-hidden="true" className="pointer-events-none absolute" style={{ left: item.left, top: item.top }}>
          <span className={`absolute -top-6 -left-6 h-12 w-12 animate-tap rounded-full border-[2.5px] ${ringTone[item.kind]}`} />
          <span className={`absolute -top-3 -left-3 h-6 w-6 animate-tap rounded-full border-2 [animation-delay:120ms] ${ringTone[item.kind]}`} />
          <span className="absolute -top-1.5 -left-1.5 h-3 w-3 rounded-full bg-green-300 shadow-[0_0_12px_4px_rgba(31,242,92,0.95)]" />
        </span>
      ))}
    </div>
  );
}

export function RemoteDock({ remote, name }: { readonly remote: RemoteControl; readonly name: string }) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typing) {
      field.current?.focus();
    }
  }, [typing]);

  if (!remote.on) {
    return null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.length === 0) {
      return;
    }
    remote.send({ kind: "type", text: draft });
    setDraft("");
  }

  const key = "grid h-9 min-w-0 flex-1 place-items-center rounded-xl border border-line bg-white/[0.03] px-1 text-[12px] font-semibold sm:flex-none sm:px-3 text-ink-muted transition-colors duration-200 ease-ui hover:border-green-400/50 hover:text-green-300 active:bg-green-400/15";

  return (
    <div className="glass-strong flex flex-col gap-2 rounded-overlay p-2 sm:p-2.5">
      {remote.paused && (
        <div className="flex items-center gap-2 rounded-xl border border-status-wait/35 bg-status-wait/[0.07] py-1.5 pr-1.5 pl-3">
          <Icon name="pause" className="h-3.5 w-3.5 shrink-0 text-status-wait" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">VENOM paused for you</span>
          <button type="button" onClick={remote.resume} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-green-400/15 px-2.5 py-1.5 text-[12px] font-semibold text-green-300 transition-colors duration-200 ease-ui hover:bg-green-400/25">
            <Icon name="play" className="h-3 w-3" />
            Carry on
          </button>
        </div>
      )}
      {typing && (
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            ref={field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={`Type on ${name}`}
            className="h-9 min-w-0 flex-1 rounded-xl border border-green-400/30 bg-black/40 px-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-green-400/70"
          />
          <button type="submit" aria-label="Send the typing" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-linear-to-b from-green-400 to-green-600 text-on-accent shadow-accent">
            <Icon name="send" className="h-4 w-4" />
          </button>
        </form>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTyping((open) => !open)}
          aria-pressed={typing}
          aria-label="Keyboard"
          className={`grid h-9 w-10 shrink-0 place-items-center rounded-xl border transition-colors duration-200 ease-ui ${typing ? "border-green-400/60 bg-green-400/15 text-green-300" : "border-line bg-white/[0.03] text-ink-muted hover:text-green-300"}`}
        >
          <Icon name="keyboard" className="h-4 w-4" />
        </button>
        <span className="h-5 w-px shrink-0 bg-line-subtle" />
        {remoteKeys.map((item) => (
          <button key={item.key} type="button" onClick={() => remote.send({ kind: "key", key: item.key })} className={key}>
            {item.label}
          </button>
        ))}
        <span className="hidden flex-1 sm:block" />
        <button type="button" onClick={remote.toggle} aria-label="Done, hand the computer back" className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-green-400/40 bg-green-400/[0.08] px-2.5 text-[12px] font-semibold text-green-300 transition-colors duration-200 ease-ui hover:bg-green-400/15 sm:px-3">
          <Icon name="check" className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Done</span>
        </button>
      </div>
    </div>
  );
}
