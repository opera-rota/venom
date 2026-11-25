import type { Device } from "@venom/contracts";
import { useEffect, useRef, useState } from "react";
import { canWork } from "../live-screen.ts";
import { sinceWords } from "../move-words.ts";
import type { DevicesState } from "../use-devices.ts";
import { button, mark, surface, text } from "../ui.ts";
import { Emblem } from "./Emblem.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Place } from "./Place.tsx";
import { Trouble } from "./Trouble.tsx";

const platformName: Record<Device["platform"], string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iPhone",
  android_tv: "Android TV",
  tvos: "Apple TV",
  wear_os: "Wear OS",
  watchos: "Apple Watch",
};

const kindIcon: Record<Device["type"], IconName> = {
  computer: "laptop",
  phone: "phone",
  tv: "screen",
  watch: "pulse",
};

type Pulse = "working" | "awake" | "locked" | "away";

function pulseOf(device: Device): Pulse {
  if (device.status !== "active") {
    return "away";
  }
  if (device.locked) {
    return "locked";
  }
  return device.in_use ? "working" : "awake";
}

const pulseView: Record<Pulse, { readonly word: string; readonly dot: string; readonly tone: string; readonly line: string }> = {
  working: { word: "Awake", dot: "bg-green-400 shadow-[0_0_10px_2px_rgba(31,242,92,0.75)]", tone: "text-green-300", line: "#4dff7c" },
  awake: { word: "Online", dot: "bg-green-400/80", tone: "text-status-ok", line: "#2fae57" },
  locked: { word: "Locked", dot: "bg-status-wait", tone: "text-status-wait", line: "#f2c46d" },
  away: { word: "Asleep or off", dot: "bg-status-idle", tone: "text-ink-faint", line: "#33463b" },
};

function shortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/u, "");
}

function spot(index: number, count: number): { readonly x: number; readonly y: number } {
  const angle = Math.PI + (index * 2 * Math.PI) / Math.max(count, 1);
  return { x: 50 + Math.cos(angle) * 37, y: 50 + Math.sin(angle) * 30 };
}

function Network({ devices, currentId }: { readonly devices: readonly Device[]; readonly currentId: string }) {
  const online = devices.filter((device) => device.status === "active").length;
  const chosen = devices.find((device) => device.in_use) ?? null;

  return (
    <section aria-label="Your symbiote network" className={`relative overflow-hidden ${surface.card}`}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(31,242,92,0.10),transparent_65%)]" />
      <div className="relative h-[200px] w-full sm:h-[250px]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <ellipse cx="50" cy="50" rx="37" ry="30" fill="none" stroke="rgba(200,255,220,0.07)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
          {devices.map((device, index) => {
            const { x, y } = spot(index, devices.length);
            const view = pulseView[pulseOf(device)];
            const live = device.status === "active";
            return (
              <g key={device.id}>
                <line x1="50" y1="50" x2={x} y2={y} stroke={view.line} strokeOpacity={live ? 0.35 : 0.25} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {live && (
                  <line x1="50" y1="50" x2={x} y2={y} stroke={view.line} strokeWidth={device.in_use ? 2.2 : 1.4} vectorEffect="non-scaling-stroke" strokeDasharray="4 18" strokeLinecap="round" className="animate-pulse-line" />
                )}
              </g>
            );
          })}
        </svg>
        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5">
          <Emblem size={62} />
          <span className="hud text-[9px] text-green-300/80">VENOM cloud</span>
        </div>
        {devices.map((device, index) => {
          const { x, y } = spot(index, devices.length);
          const view = pulseView[pulseOf(device)];
          return (
            <div key={device.id} className="absolute flex w-[150px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center" style={{ left: `${x}%`, top: `${y}%` }}>
              <span
                className={`relative grid place-items-center rounded-[14px] border backdrop-blur ${
                  device.in_use ? "ring-live h-14 w-14 border-green-400/60 bg-green-400/[0.12] text-green-300 shadow-[0_0_30px_-6px_rgba(31,242,92,0.8)]" : "h-12 w-12 border-line-strong bg-black/50 text-ink-muted"
                } ${device.status === "active" ? "" : "opacity-55"}`}
              >
                <Icon name={kindIcon[device.type]} className={device.in_use ? "h-6 w-6" : "h-5 w-5"} />
                <span className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-base ${view.dot}`} />
              </span>
              <span className="max-w-full truncate text-[12px] font-semibold text-ink">{shortName(device.name)}</span>
              <span className={`hud -mt-1 text-[8.5px] ${device.in_use ? "text-green-300" : "text-ink-faint"}`}>{device.in_use ? "In use" : device.id === currentId ? "This device" : view.word}</span>
            </div>
          );
        })}
      </div>
      <div className="relative grid grid-cols-[auto_auto_minmax(0,1fr)] border-t border-line-subtle">
        {[
          { label: "Bodies", value: String(devices.length) },
          { label: "Online", value: String(online) },
          { label: "In use", value: chosen === null ? "None" : shortName(chosen.name) },
        ].map((stat, index) => (
          <div key={stat.label} className={`flex min-w-0 flex-col gap-0.5 px-4 py-3 ${index > 0 ? "border-l border-line-subtle" : ""}`}>
            <span className="hud text-[9px] text-ink-faint">{stat.label}</span>
            <span className="tabular truncate text-[15px] font-semibold text-ink">{stat.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RemoveGate({ device, current, onCancel, onConfirm }: { readonly device: Device; readonly current: boolean; readonly onCancel: () => void; readonly onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-labelledby={`remove-${device.id}`} className="flex flex-col gap-3 border-t border-line-subtle pt-3">
      <p id={`remove-${device.id}`} className={text.support}>
        {current ? "Sign this computer out? Coming back needs your email, secret word and an emailed code." : `Remove ${shortName(device.name)}? It stops at once and needs your email, secret word and a code to rejoin.`}
      </p>
      <div className="flex gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={button.gateCancel}>
          Keep it
        </button>
        <button type="button" onClick={onConfirm} className={button.gateApprove}>
          <Icon name="warning" className="h-3.5 w-3.5 text-status-wait" />
          <span>{current ? "Sign out" : "Remove"}</span>
        </button>
      </div>
    </div>
  );
}

interface DeviceTileProps {
  readonly device: Device;
  readonly current: boolean;
  readonly using: boolean;
  readonly busy: boolean;
  readonly onRemove: () => Promise<boolean>;
  readonly onUse: () => void;
}

function DeviceTile({ device, current, using, busy, onRemove, onUse }: DeviceTileProps) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const view = pulseView[pulseOf(device)];
  const workable = canWork(device);

  async function confirm() {
    setRemoving(true);
    const removed = await onRemove();
    setRemoving(false);
    if (!removed) {
      setConfirming(false);
    }
  }

  return (
    <li className={`flex flex-col gap-4 p-4 ${device.in_use ? surface.cardActive : surface.card}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border ${device.in_use ? "border-green-400/50 bg-green-400/[0.1] text-green-300" : "border-line bg-black/40 text-ink-muted"}`}>
          <Icon name={kindIcon[device.type]} className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[14.5px] font-semibold text-ink" title={device.name}>
            {device.name}
          </span>
          <span className="text-[12px] text-ink-faint">
            {platformName[device.platform]}
            {device.last_seen_at !== null && ` · seen ${sinceWords(device.last_seen_at, Date.now())}`}
          </span>
        </div>
        {device.in_use && (
          <span className="hud inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-400/15 px-2.5 py-1 text-[9px] text-green-300 shadow-[0_0_0_1px_rgba(77,255,124,0.5),0_0_14px_-2px_rgba(31,242,92,0.7)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            In use
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-line-subtle bg-black/30 px-2.5 py-1 text-[11.5px] font-medium ${view.tone}`}>
          <span className={`${mark.dot} ${view.dot}`} />
          {view.word}
        </span>
        {current && <span className={mark.tag}>This device</span>}
        {device.locked && (
          <span className={mark.caution}>
            <Icon name="lock" className="mr-1 h-3 w-3" />
            Unlock to continue
          </span>
        )}
      </div>
      {confirming ? (
        <RemoveGate device={device} current={current} onCancel={() => setConfirming(false)} onConfirm={() => void confirm()} />
      ) : (
        <div className="flex items-center justify-between gap-2 border-t border-line-subtle pt-3">
          {workable && !device.in_use ? (
            <button type="button" onClick={onUse} disabled={busy} className={button.compact}>
              <Icon name="bolt" className="h-3.5 w-3.5" />
              {using ? "Choosing…" : "Use this device"}
            </button>
          ) : (
            <span className="text-[12px] text-ink-faint">{device.in_use ? "VENOM works here" : "Watches and guides"}</span>
          )}
          <button type="button" onClick={() => setConfirming(true)} disabled={removing} className={`${button.mini} hover:text-red-400`}>
            <Icon name="trash" className="h-3.5 w-3.5" />
            {current ? "Sign out" : "Remove"}
          </button>
        </div>
      )}
    </li>
  );
}

export function DevicesPlace({ state }: { readonly state: DevicesState }) {
  const ordered = [...state.devices].sort((left, right) => Number(right.in_use) - Number(left.in_use) || Number(right.status === "active") - Number(left.status === "active"));

  return (
    <Place title="Devices" eyebrow="Symbiote network" icon="devices" count={state.devices.length} width="wide">
      {state.failure !== null && <Trouble reason={state.failure} />}
      {state.devices.length > 0 && <Network devices={state.devices} currentId={state.currentId} />}
      <ul className="grid gap-3 sm:grid-cols-2">
        {ordered.map((device) => (
          <DeviceTile
            key={device.id}
            device={device}
            current={device.id === state.currentId}
            using={state.using === device.id}
            busy={state.using !== null}
            onRemove={() => state.remove(device.id)}
            onUse={() => void state.use(device.id)}
          />
        ))}
      </ul>
      <p className="flex items-center gap-2 px-1 text-[12px] text-ink-faint">
        <Icon name="plus" className="h-3 w-3" />
        To add a device, open VENOM on it and choose Attach this device.
      </p>
    </Place>
  );
}
