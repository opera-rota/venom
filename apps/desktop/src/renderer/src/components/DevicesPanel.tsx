import type { Device, DeviceStatus } from "@venom/contracts";
import { useEffect, useRef, useState } from "react";
import type { DevicesState } from "../use-devices.ts";
import { button, field, mark, surface, text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";

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

function DeviceRow({ device, current, onRemove }: { readonly device: Device; readonly current: boolean; readonly onRemove: () => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = statusView[device.status === "revoked" ? "offline" : device.status];

  async function confirm() {
    setBusy(true);
    const removed = await onRemove();
    setBusy(false);
    if (!removed) {
      setConfirming(false);
    }
  }

  return (
    <li className={`p-4 ${surface.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <Icon name="devices" className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="truncate font-medium text-ink">{device.name}</span>
            {current && <span className={mark.tag}>This device</span>}
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
          <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={button.destructive}>
            {current ? "Sign out" : "Remove"}
          </button>
        )}
      </div>
      {confirming && <RemoveGate device={device} current={current} onCancel={() => setConfirming(false)} onConfirm={() => void confirm()} />}
    </li>
  );
}

export function DevicesPanel({ state, onClose }: { readonly state: DevicesState; readonly onClose: () => void }) {
  const count = state.devices.length;

  return (
    <aside aria-label="Devices" className={`flex w-[340px] max-w-full shrink-0 flex-col ${surface.panel}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className={text.section}>
          Devices <span className="tabular text-green-400">{count}</span>
        </h2>
        <button type="button" onClick={onClose} className={button.ghost} aria-label="Close devices">
          <Icon name="cross" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className={text.support}>Every device here is a body of the same VENOM. Add another by choosing "Attach this device" on it.</p>
        {state.failure !== null && (
          <p role="alert" className={field.error}>
            <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{state.failure}</span>
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {state.devices.map((device) => (
            <DeviceRow key={device.id} device={device} current={device.id === state.currentId} onRemove={() => state.remove(device.id)} />
          ))}
        </ul>
      </div>
    </aside>
  );
}
