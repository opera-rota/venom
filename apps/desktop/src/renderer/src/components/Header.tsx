import type { ConnectionState } from "../../../shared/bridge.ts";
import { mark, text } from "../ui.ts";
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

export function Header({ connection }: { readonly connection: ConnectionState }) {
  const view = connectionView[connection];

  return (
    <header className="flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-3.5">
      <div className="flex items-center gap-3">
        <LogoMark size={28} />
        <h1 className={text.section}>VENOM</h1>
      </div>
      <div role="status" aria-live="polite" className={`flex items-center gap-2 ${text.detail} ${view.tone}`}>
        <span className={`${mark.dot} ${view.dot}`} />
        <Icon name={view.icon} />
        <span>{view.label}</span>
      </div>
    </header>
  );
}
