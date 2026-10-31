import type { PowerStatus } from "@venom/contracts";
import type { ConnectionState, HaltView } from "../../../shared/bridge.ts";
import type { TaskCount } from "../tasks-state.ts";
import { button, mark, text } from "../ui.ts";
import { HaltSwitch } from "./HaltSwitch.tsx";
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

export type SidePanel = "tasks" | "devices" | "power" | "memory" | "safety";

const panelButtons: readonly { readonly panel: Exclude<SidePanel, "power">; readonly label: string; readonly icon: IconName }[] = [
  { panel: "tasks", label: "Tasks", icon: "list" },
  { panel: "memory", label: "Memory", icon: "memory" },
  { panel: "devices", label: "Devices", icon: "devices" },
  { panel: "safety", label: "Safety", icon: "shield" },
];

export interface HeaderProps {
  readonly connection: ConnectionState;
  readonly accountName: string;
  readonly power: PowerStatus | null;
  readonly engineName: string | null;
  readonly panel: SidePanel | null;
  readonly onTogglePanel: (panel: SidePanel) => void;
  readonly halt: HaltView;
  readonly onStop: () => void;
  readonly taskCount: TaskCount;
}

function gaugeLabel(power: PowerStatus, engineName: string): string {
  if (power.engine_class === "free") {
    return `${engineName} · ${Math.max(0, power.free_daily_answers - power.free_used_today)} free left`;
  }
  return `${engineName} · ${new Intl.NumberFormat().format(power.balance)} power`;
}

function taskLabel({ open, needsYou }: TaskCount): string {
  if (open === 0) {
    return "Tasks";
  }
  return `Tasks, ${open} open${needsYou ? ", one needs you" : ""}`;
}

export function Header({ connection, accountName, power, engineName, panel, onTogglePanel, halt, onStop, taskCount }: HeaderProps) {
  const view = connectionView[connection];

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-subtle px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <LogoMark size={28} />
        <h1 className={text.section}>VENOM</h1>
        <span className={`truncate ${text.support}`}>{accountName}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <div role="status" aria-live="polite" className={`flex items-center gap-2 ${text.detail} ${view.tone}`}>
          <span className={`${mark.dot} ${view.dot}`} />
          <Icon name={view.icon} />
          <span>{view.label}</span>
        </div>
        {power !== null && engineName !== null && (
          <button
            type="button"
            onClick={() => onTogglePanel("power")}
            aria-pressed={panel === "power"}
            className={`${button.ghost} tabular-nums ${panel === "power" ? "text-green-400" : ""}`}
          >
            <Icon name="bolt" className="h-4 w-4" />
            <span className="whitespace-nowrap">{gaugeLabel(power, engineName)}</span>
          </button>
        )}
        {panelButtons.map((entry) => (
          <button
            key={entry.panel}
            type="button"
            onClick={() => onTogglePanel(entry.panel)}
            aria-pressed={panel === entry.panel}
            aria-label={entry.panel === "tasks" ? taskLabel(taskCount) : entry.label}
            title={entry.panel === "tasks" ? taskLabel(taskCount) : entry.label}
            className={`${button.ghost} ${panel === entry.panel ? "text-green-400" : ""}`}
          >
            <Icon name={entry.icon} className="h-4 w-4" />
            <span className="hidden xl:inline">{entry.label}</span>
            {entry.panel === "tasks" && taskCount.open > 0 && (
              <span className={`${mark.badge} ${taskCount.needsYou ? "bg-status-wait text-on-accent" : "bg-(--tint-accent) text-green-300"}`}>{taskCount.open}</span>
            )}
          </button>
        ))}
        <HaltSwitch view={halt} onStop={onStop} />
      </div>
    </header>
  );
}
