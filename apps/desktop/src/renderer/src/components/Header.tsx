import type { ConnectionState, HaltView } from "../../../shared/bridge.ts";
import { mark, text } from "../ui.ts";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu.tsx";
import { HaltSwitch } from "./HaltSwitch.tsx";
import { Icon, type IconName } from "./Icon.tsx";

const connectionView: Record<ConnectionState, { readonly label: string; readonly icon: IconName; readonly tone: string; readonly dot: string }> = {
  online: { label: "Connected", icon: "check", tone: "text-status-ok", dot: "bg-status-ok" },
  connecting: { label: "Connecting", icon: "hourglass", tone: "text-status-wait", dot: "bg-status-wait" },
  offline: { label: "Ooh, lost the network. Reconnecting by myself", icon: "hourglass", tone: "text-status-wait", dot: "bg-status-wait" },
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
  readonly deviceCount: number;
  readonly menu: AccountMenuProps;
  readonly halt: HaltView;
  readonly onStop: () => void;
}

export function Header({ connection, deviceCount, menu, halt, onStop }: HeaderProps) {
  const view = connectionView[connection];

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-subtle px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <LogoMark size={28} />
        <h1 className={`${text.section} hidden sm:block`}>VENOM</h1>
        <AccountMenu {...menu} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <div role="status" aria-live="polite" className={`flex items-center gap-2 ${text.detail} ${view.tone}`}>
          <span className={`${mark.dot} ${view.dot}`} />
          <Icon name={view.icon} />
          <span>{view.label}</span>
          {deviceCount > 0 && (
            <span className="tabular-nums text-ink-muted">
              · {deviceCount} {deviceCount === 1 ? "device" : "devices"}
            </span>
          )}
        </div>
        <HaltSwitch view={halt} onStop={onStop} />
      </div>
    </header>
  );
}
