import type { ConnectionState } from "../../../shared/bridge.ts";
import { button, mark, text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";

const connectionView: Record<ConnectionState, { readonly label: string; readonly icon: IconName; readonly tone: string; readonly dot: string }> = {
  online: { label: "Connected", icon: "check", tone: "text-status-ok", dot: "bg-status-ok" },
  connecting: { label: "Connecting", icon: "hourglass", tone: "text-status-wait", dot: "bg-status-wait" },
  offline: { label: "Gateway unreachable, retrying", icon: "cross", tone: "text-status-fail", dot: "bg-status-fail" },
};

export function LogoMark({ size }: { readonly size: number }) {
  return (
    <span className={mark.logo} style={{ width: size, height: size, fontSize: size * 0.48 }} aria-hidden="true">
      V
    </span>
  );
}

export interface HeaderProps {
  readonly connection: ConnectionState;
  readonly accountName: string;
  readonly devicesOpen: boolean;
  readonly onToggleDevices: () => void;
}

export function Header({ connection, accountName, devicesOpen, onToggleDevices }: HeaderProps) {
  const view = connectionView[connection];

  return (
    <header className="flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <LogoMark size={28} />
        <h1 className={text.section}>VENOM</h1>
        <span className={`truncate ${text.support}`}>{accountName}</span>
      </div>
      <div className="flex items-center gap-2">
        <div role="status" aria-live="polite" className={`flex items-center gap-2 ${text.detail} ${view.tone}`}>
          <span className={`${mark.dot} ${view.dot}`} />
          <Icon name={view.icon} />
          <span>{view.label}</span>
        </div>
        <button type="button" onClick={onToggleDevices} aria-pressed={devicesOpen} className={`${button.ghost} ${devicesOpen ? "text-green-400" : ""}`}>
          <Icon name="devices" className="h-4 w-4" />
          <span>Devices</span>
        </button>
      </div>
    </header>
  );
}
