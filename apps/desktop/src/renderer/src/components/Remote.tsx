import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import { gesture, panBy, pictureBox, remoteKeys, spotIn, viewLimits, zoomAt, type RemoteAction, type RemoteControl, type RemoteSpot, type RemoteTouchKind, type View } from "../remote.ts";
import { Icon } from "./Icon.tsx";

interface Ring {
  readonly id: number;
  readonly left: number;
  readonly top: number;
  readonly kind: RemoteTouchKind;
}

interface Aim {
  readonly pointer: number;
  readonly startX: number;
  readonly startY: number;
  readonly touch: boolean;
  x: number;
  y: number;
  moved: boolean;
}

interface Pinch {
  readonly distance: number;
  readonly midX: number;
  readonly midY: number;
  readonly left: number;
  readonly top: number;
  readonly view: View;
}

export interface Loupe {
  readonly x: number;
  readonly y: number;
}

interface Frame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const loupeSize = 132;

const ringTone: Record<Ring["kind"], string> = {
  click: "border-green-300 shadow-[0_0_18px_4px_rgba(31,242,92,0.55)]",
  double: "border-green-200 shadow-[0_0_22px_6px_rgba(31,242,92,0.7)]",
  right: "border-status-wait shadow-[0_0_18px_4px_rgba(242,196,109,0.55)]",
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
      className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-[background-color,box-shadow,color] duration-200 ease-ui ${
        remote.on
          ? "bg-linear-to-b from-green-400 to-green-600 text-on-accent shadow-[0_0_0_1px_rgba(77,255,124,0.7),0_0_22px_-2px_rgba(31,242,92,0.85)]"
          : "glass-strong text-ink hover:border-green-400/50 hover:text-green-300"
      }`}
    >
      <Icon name="tap" className="h-4 w-4" />
      Remote
    </button>
  );
}

function distance(a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function RemoteLayer({
  video,
  view,
  secondary,
  onView,
  onAction,
  onLoupe,
}: {
  readonly video: RefObject<HTMLVideoElement | null>;
  readonly view: View;
  readonly secondary: boolean;
  readonly onView: (view: View) => void;
  readonly onAction: (action: RemoteAction) => void;
  readonly onLoupe: (loupe: Loupe | null) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const aim = useRef<Aim | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const settling = useRef(false);
  const single = useRef<{ readonly timer: number; readonly x: number; readonly y: number } | null>(null);
  const counter = useRef(0);
  const [rings, setRings] = useState<readonly Ring[]>([]);

  useEffect(
    () => () => {
      if (single.current !== null) {
        window.clearTimeout(single.current.timer);
      }
    },
    [],
  );

  function frame(): Frame | null {
    const element = video.current;
    if (element === null) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return { left: rect.left - view.x, top: rect.top - view.y, width: element.offsetWidth, height: element.offsetHeight };
  }

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

  function stopAiming() {
    aim.current = null;
    onLoupe(null);
  }

  function startPinch() {
    const [first, second] = [...pointers.current.values()];
    const box = frame();
    if (first === undefined || second === undefined || box === null) {
      return;
    }
    pinch.current = { distance: Math.max(1, distance(first, second)), midX: (first.x + second.x) / 2, midY: (first.y + second.y) / 2, left: box.left, top: box.top, view };
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      stopAiming();
      settling.current = true;
      startPinch();
      return;
    }
    if (settling.current) {
      return;
    }
    const touching = event.pointerType !== "mouse";
    aim.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, touch: touching, x: event.clientX, y: event.clientY, moved: false };
    if (touching) {
      onLoupe({ x: event.clientX, y: event.clientY });
    }
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) {
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinching = pinch.current;
    if (pinching !== null) {
      const [first, second] = [...pointers.current.values()];
      const box = frame();
      if (first === undefined || second === undefined || box === null) {
        return;
      }
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      const zoomed = zoomAt(pinching.view, distance(first, second) / pinching.distance, pinching.midX - pinching.left, pinching.midY - pinching.top, box.width, box.height);
      onView(panBy(zoomed, midX - pinching.midX, midY - pinching.midY, box.width, box.height));
      return;
    }
    const started = aim.current;
    if (started === null || started.pointer !== event.pointerId) {
      return;
    }
    started.x = event.clientX;
    started.y = event.clientY;
    if (!started.moved && Math.hypot(event.clientX - started.startX, event.clientY - started.startY) > gesture.slop) {
      started.moved = true;
    }
    if (started.touch) {
      onLoupe({ x: event.clientX, y: event.clientY });
    }
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pinch.current !== null) {
      if (pointers.current.size < 2) {
        pinch.current = null;
      }
      if (pointers.current.size === 0) {
        settling.current = false;
      }
      return;
    }
    if (pointers.current.size === 0) {
      settling.current = false;
    }
    const started = aim.current;
    if (started === null || started.pointer !== event.pointerId) {
      return;
    }
    stopAiming();
    if (secondary) {
      touch("right", started.x, started.y);
      return;
    }
    if (started.moved) {
      touch("click", started.x, started.y);
      return;
    }
    const waiting = single.current;
    if (waiting !== null && Math.hypot(started.x - waiting.x, started.y - waiting.y) <= gesture.slop * 3) {
      window.clearTimeout(waiting.timer);
      single.current = null;
      touch("double", waiting.x, waiting.y);
      return;
    }
    const { x, y } = started;
    single.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        single.current = null;
        touch("click", x, y);
      }, gesture.doubleMs),
    };
  }

  function cancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinch.current = null;
    }
    if (pointers.current.size === 0) {
      settling.current = false;
    }
    stopAiming();
  }

  function wheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.deltaY === 0) {
      return;
    }
    if (event.ctrlKey) {
      const box = frame();
      if (box !== null) {
        onView(zoomAt(view, event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - box.left, event.clientY - box.top, box.width, box.height));
      }
      return;
    }
    const spot = spotAt(event.clientX, event.clientY);
    if (spot !== null) {
      onAction({ kind: "scroll", spot, direction: event.deltaY > 0 ? "down" : "up", steps: Math.min(3, Math.max(1, Math.round(Math.abs(event.deltaY) / 100))) });
    }
  }

  return (
    <div
      ref={layer}
      role="application"
      aria-label="Remote control of the live screen"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onWheel={wheel}
      onContextMenu={(event) => {
        event.preventDefault();
        if (aim.current === null) {
          touch("right", event.clientX, event.clientY);
        }
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

export function RemoteLens({ video, stream, area, loupe, view }: { readonly video: RefObject<HTMLVideoElement | null>; readonly stream: MediaStream; readonly area: RefObject<HTMLDivElement | null>; readonly loupe: Loupe; readonly view: View }) {
  const lens = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = lens.current;
    if (element !== null && element.srcObject !== stream) {
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    }
  }, [stream]);

  const element = video.current;
  const box = area.current?.getBoundingClientRect();
  if (element === null || box === undefined) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const power = view.scale >= 2.5 ? 1.6 : gesture.loupe;
  const half = loupeSize / 2;
  const left = Math.min(Math.max(loupe.x - box.left - half, 4), box.width - loupeSize - 4);
  const above = loupe.y - box.top - loupeSize - 28;
  const top = above < 4 ? Math.min(loupe.y - box.top + 28, box.height - loupeSize - 4) : above;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-30 overflow-hidden rounded-full border-2 border-green-300 bg-black shadow-[0_0_0_4px_rgba(5,8,6,0.75),0_0_30px_-2px_rgba(31,242,92,0.9)]"
      style={{ left, top, width: loupeSize, height: loupeSize }}
    >
      <video
        ref={lens}
        muted
        playsInline
        className="absolute max-w-none object-contain"
        style={{ left: half - (loupe.x - rect.left) * power, top: half - (loupe.y - rect.top) * power, width: rect.width * power, height: rect.height * power }}
      />
      <span className="absolute top-1/2 left-1/2 h-px w-7 -translate-x-1/2 bg-green-300 shadow-[0_0_6px_rgba(31,242,92,0.9)]" />
      <span className="absolute top-1/2 left-1/2 h-7 w-px -translate-y-1/2 bg-green-300 shadow-[0_0_6px_rgba(31,242,92,0.9)]" />
      <span className="absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-green-300" />
    </span>
  );
}

export function ZoomBar({ view, onZoom, onFit }: { readonly view: View; readonly onZoom: (factor: number) => void; readonly onFit: () => void }) {
  const round = "grid h-9 w-9 place-items-center rounded-full text-ink transition-colors duration-200 ease-ui hover:text-green-300 disabled:text-ink-faint";
  return (
    <div className="glass-strong pointer-events-auto flex items-center gap-0.5 rounded-full p-0.5" role="group" aria-label="Zoom">
      <button type="button" className={round} onClick={() => onZoom(1 / viewLimits.step)} disabled={view.scale <= viewLimits.min} aria-label="Zoom out">
        <Icon name="dash" className="h-4 w-4" />
      </button>
      <button type="button" onClick={onFit} disabled={view.scale <= viewLimits.min} className="hud min-w-11 rounded-full px-1.5 text-center text-[11px] text-green-300 tabular-nums disabled:text-ink-faint" aria-label="Fit the whole screen">
        {view.scale.toFixed(1)}×
      </button>
      <button type="button" className={round} onClick={() => onZoom(viewLimits.step)} disabled={view.scale >= viewLimits.max} aria-label="Zoom in">
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </div>
  );
}

export function RemoteDock({
  remote,
  name,
  spot,
  secondary,
  floating,
  onSecondary,
}: {
  readonly remote: RemoteControl;
  readonly name: string;
  readonly spot: RemoteSpot;
  readonly secondary: boolean;
  readonly floating: boolean;
  readonly onSecondary: () => void;
}) {
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

  const key =
    "grid h-10 min-w-0 place-items-center rounded-xl border border-line bg-white/[0.04] px-1 text-[12.5px] font-semibold text-ink transition-colors duration-200 ease-ui hover:border-green-400/50 hover:text-green-300 active:bg-green-400/20 sm:min-w-10 sm:px-3";

  return (
    <div className={`flex flex-col gap-2 p-2 sm:p-2.5 ${floating ? "glass-strong rounded-[22px] bg-black/55 shadow-[0_10px_40px_-8px_rgba(0,0,0,0.9)] backdrop-blur-md" : "glass-strong rounded-overlay"}`}>
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
            className="h-10 min-w-0 flex-1 rounded-xl border border-green-400/30 bg-black/50 px-3 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-green-400/70"
          />
          <button type="submit" aria-label="Send the typing" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-linear-to-b from-green-400 to-green-600 text-on-accent shadow-accent">
            <Icon name="send" className="h-4 w-4" />
          </button>
        </form>
      )}
      <div className="grid grid-cols-5 gap-1.5 sm:flex sm:items-center">
        <button
          type="button"
          onClick={() => setTyping((open) => !open)}
          aria-pressed={typing}
          aria-label="Keyboard"
          className={`grid h-10 shrink-0 place-items-center sm:w-11 rounded-xl border transition-colors duration-200 ease-ui ${typing ? "border-green-400/60 bg-green-400/15 text-green-300" : "border-line bg-white/[0.04] text-ink hover:text-green-300"}`}
        >
          <Icon name="keyboard" className="h-[18px] w-[18px]" />
        </button>
        {remoteKeys.map((item) => (
          <button key={item.key} type="button" onClick={() => remote.send({ kind: "key", key: item.key })} className={key}>
            {item.label}
          </button>
        ))}
        <span className="hidden h-6 w-px shrink-0 bg-line-subtle sm:block" />
        <button
          type="button"
          onClick={onSecondary}
          aria-pressed={secondary}
          aria-label="Next tap is a right click"
          className={`grid h-10 min-w-0 place-items-center rounded-xl border transition-colors duration-200 ease-ui sm:w-10 ${secondary ? "border-status-wait/70 bg-status-wait/15 text-status-wait" : "border-line bg-white/[0.04] text-ink hover:text-green-300"}`}
        >
          <Icon name="mouse" className="h-[18px] w-[18px]" />
        </button>
        <button type="button" aria-label="Scroll up" onClick={() => remote.send({ kind: "scroll", spot, direction: "up", steps: 3 })} className={key}>
          <Icon name="chevron" className="h-4 w-4 rotate-180" />
        </button>
        <button type="button" aria-label="Scroll down" onClick={() => remote.send({ kind: "scroll", spot, direction: "down", steps: 3 })} className={key}>
          <Icon name="chevron" className="h-4 w-4" />
        </button>
        <span className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={remote.toggle}
          aria-label="Done, hand the computer back"
          className="col-span-2 flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-green-400/40 bg-green-400/[0.08] px-3 text-[12.5px] font-semibold text-green-300 transition-colors duration-200 ease-ui hover:bg-green-400/15"
        >
          <Icon name="check" className="h-4 w-4" />
          Done
        </button>
      </div>
    </div>
  );
}
