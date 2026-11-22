import type { Device, DeviceStatus } from "@venom/contracts";
import { useEffect, useRef, useState } from "react";
import { canWork } from "../live-screen.ts";
import type { DevicesState } from "../use-devices.ts";
import { button, mark, surface, text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Place } from "./Place.tsx";
import { Trouble } from "./Trouble.tsx";

const statusView: Record<Exclude<DeviceStatus, "revoked">, { readonly label: string; readonly icon: IconName; readonly dot: string; readonly tone: string }> = {
  active: { label: "Online", icon: "check", dot: "bg-status-ok", tone: "text-status-ok" },
  offline: { label: "Offline", icon: "dash", dot: "bg-status-idle", tone: "text-ink-muted" },
  registered: { label: "Not connected yet", icon: "hourglass", dot: "bg-status-idle", tone: "text-ink-muted" },
};

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

const seenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function RemoveGate({ device, current, onCancel, onConfirm }: { readonly device: Device; readonly current: boolean; readonly onCancel: () => void; readonly onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-labelledby={`remove-${device.id}`} className="mt-3 flex flex-col gap-3 border-t border-line-subtle pt-3">
      <p id={`remove-${device.id}`} className={text.support}>
        {current
          ? "Sign this computer out of VENOM? To use it again you will need your email, your secret word and an emailed code."
          : `Remove ${device.name} from VENOM? It stops working at once and needs your email, secret word and an emailed code to join again.`}
      </p>
      <div className="flex gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={button.gateCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className={button.gateApprove}>
          <Icon name="warning" className="h-3.5 w-3.5 text-status-wait" />
          <span>{current ? "Sign out" : "Remove"}</span>
        </button>
      </div>
    </div>
  );
}

interface DeviceRowProps {
  readonly device: Device;
  readonly current: boolean;
  readonly using: boolean;
  readonly busy: boolean;
  readonly onRemove: () => Promise<boolean>;
  readonly onUse: () => void;
}

function DeviceRow({ device, current, using, busy, onRemove, onUse }: DeviceRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const view = statusView[device.status === "revoked" ? "offline" : device.status];
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
    <li className={`p-4 ${device.in_use ? surface.cardActive : surface.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name="devices" className={`h-4 w-4 shrink-0 ${device.in_use ? "text-green-300" : "text-ink-muted"}`} />
            <span className="truncate font-medium text-ink">{device.name}</span>
            {current && <span className={mark.tag}>This device</span>}
            {device.in_use && (
              <span className="hud inline-flex items-center gap-1.5 rounded-full bg-green-400/15 px-2.5 py-0.5 text-[9.5px] text-green-300 shadow-[0_0_0_1px_rgba(77,255,124,0.5),0_0_14px_-2px_rgba(31,242,92,0.7)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                In use
              </span>
            )}
            {device.locked && (
              <span className={mark.caution}>
                <Icon name="lock" className="mr-1 h-3 w-3" />
                Locked
              </span>
            )}
          </div>
          <span className={text.support}>
            {platformName[device.platform]}
            {device.last_seen_at !== null && ` · last seen ${seenFormat.format(new Date(device.last_seen_at))}`}
          </span>
          <span className={`flex items-center gap-1.5 ${text.detail} ${view.tone}`}>
            <span className={`${mark.dot} ${view.dot}`} />
            <Icon name={view.icon} />
            <span>{view.label}</span>
          </span>
        </div>
        {!confirming && (
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            {workable && !device.in_use && (
              <button type="button" onClick={onUse} disabled={busy} className={button.compact}>
                <Icon name="bolt" className="h-3.5 w-3.5" />
                {using ? "Choosing…" : "Use this device"}
              </button>
            )}
            <button type="button" onClick={() => setConfirming(true)} disabled={removing} className={button.destructive}>
              {current ? "Sign out" : "Remove"}
            </button>
          </div>
        )}
      </div>
      {confirming && <RemoveGate device={device} current={current} onCancel={() => setConfirming(false)} onConfirm={() => void confirm()} />}
    </li>
  );
}

export function DevicesPlace({ state }: { readonly state: DevicesState }) {
  return (
    <Place title="Devices" eyebrow="Symbiote network" icon="devices" count={state.devices.length}>
      <p className={text.support}>Every device here is a body of the same VENOM. Choose the computer VENOM works on with "Use this device"; Screen shows it live. Add another device by choosing "Attach this device" on it.</p>
      {state.failure !== null && <Trouble reason={state.failure} />}
      <ul className="flex flex-col gap-3">
        {state.devices.map((device) => (
          <DeviceRow
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
    </Place>
  );
}
