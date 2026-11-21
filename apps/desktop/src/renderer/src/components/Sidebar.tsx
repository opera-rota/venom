import { mark, text } from "../ui.ts";
import { Emblem } from "./Emblem.tsx";
import { Icon, type IconName } from "./Icon.tsx";

export type PlaceName = "chat" | "screen" | "devices" | "memory" | "models";

export const placeNames: readonly PlaceName[] = ["chat", "screen", "devices", "memory", "models"];

const placeView: Record<PlaceName, { readonly label: string; readonly icon: IconName }> = {
  chat: { label: "Chat", icon: "chat" },
  screen: { label: "Screen", icon: "screen" },
  devices: { label: "Devices", icon: "devices" },
  memory: { label: "Memory", icon: "memory" },
  models: { label: "Models", icon: "bolt" },
};

export interface SidebarSignals {
  readonly waiting: boolean;
  readonly working: boolean;
  readonly later: number;
}

export interface SidebarProps {
  readonly current: PlaceName;
  readonly signals: SidebarSignals;
  readonly engine: string | null;
  readonly onChoose: (place: PlaceName) => void;
}

function spoken(place: PlaceName, signals: SidebarSignals): string {
  const label = placeView[place].label;
  if (place === "chat" && signals.waiting) {
    return `${label}, a question waits for you`;
  }
  const parts = [label];
  if (place === "screen" && signals.working) {
    parts.push("VENOM is working");
  }
  if (place === "screen" && signals.later > 0) {
    parts.push(`${signals.later} new for later`);
  }
  return parts.join(", ");
}

function Signal({ place, signals }: { readonly place: PlaceName; readonly signals: SidebarSignals }) {
  if (place === "chat" && signals.waiting) {
    return <span className={`${mark.dot} bg-status-wait shadow-[0_0_8px_1px_rgba(242,196,109,0.8)]`} aria-hidden="true" />;
  }
  if (place === "screen" && signals.working) {
    return <span className={`${mark.dot} animate-pulse bg-green-400 shadow-[0_0_8px_1px_rgba(31,242,92,0.8)] motion-reduce:animate-none`} aria-hidden="true" />;
  }
  return null;
}

export function Sidebar({ current, signals, engine, onChoose }: SidebarProps) {
  return (
    <nav
      aria-label="Places"
      className="glass min-[960px]:glass-thin fixed inset-x-3 bottom-3 z-30 flex shrink-0 justify-around rounded-[22px] p-1.5 min-[960px]:static min-[960px]:inset-auto min-[960px]:w-[76px] min-[960px]:flex-col min-[960px]:justify-start min-[960px]:gap-1.5 min-[960px]:rounded-panel min-[960px]:p-2.5 xl:w-[232px]"
    >
      {placeNames.map((place) => {
        const view = placeView[place];
        const chosen = place === current;
        return (
          <button
            key={place}
            type="button"
            onClick={() => onChoose(place)}
            aria-current={chosen ? "page" : undefined}
            aria-label={spoken(place, signals)}
            title={view.label}
            className={`group relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10.5px] font-medium transition-[color,background-color,box-shadow] duration-200 ease-ui min-[960px]:flex-none min-[960px]:py-3 xl:flex-row xl:gap-3.5 xl:px-3.5 xl:text-[14.5px] ${
              chosen
                ? "bg-linear-to-r from-green-400/25 via-green-500/10 to-transparent text-green-300 shadow-[inset_0_0_0_1px_rgba(77,255,124,0.35),0_0_26px_-8px_rgba(31,242,92,0.7)]"
                : "text-ink-muted hover:bg-white/[0.04] hover:text-ink"
            }`}
          >
            {chosen && <span className="absolute top-1/2 left-0 hidden h-7 w-[3px] -translate-y-1/2 rounded-full bg-green-400 shadow-[0_0_12px_2px_rgba(31,242,92,0.9)] xl:block" aria-hidden="true" />}
            <span
              className={`relative grid h-9 w-9 place-items-center rounded-xl transition-colors duration-300 ${
                chosen ? "bg-green-400/20 text-green-300 shadow-[0_0_18px_-4px_rgba(31,242,92,0.9)]" : "bg-white/[0.03] group-hover:bg-white/[0.06]"
              }`}
            >
              <Icon name={view.icon} className="h-[18px] w-[18px]" />
              <span className="absolute -top-0.5 -right-0.5 xl:hidden">
                <Signal place={place} signals={signals} />
              </span>
            </span>
            <span className="truncate min-[960px]:hidden xl:inline xl:flex-1 xl:text-left">{view.label}</span>
            <span className="hidden xl:inline-flex">
              <Signal place={place} signals={signals} />
            </span>
            {place === "screen" && signals.later > 0 && (
              <span className={`${mark.badge} absolute top-1 right-1 bg-green-400 text-on-accent xl:static`} aria-hidden="true">
                {signals.later}
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto hidden flex-col gap-4 pt-4 xl:flex">
        <button
          type="button"
          onClick={() => onChoose("models")}
          className="glass-glow group flex items-center gap-3 rounded-2xl p-3 text-left transition-transform duration-300 ease-ui hover:-translate-y-0.5"
        >
          <Emblem size={42} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold text-ink">VENOM</span>
            <span className={`flex min-w-0 items-center gap-1 ${text.detail} text-ink-muted`}>
              <Icon name="bolt" className="h-3 w-3 shrink-0 text-green-400" />
              <span className="truncate">{engine ?? "AI companion"}</span>
            </span>
          </span>
          <Icon name="arrow" className="h-4 w-4 text-green-300 transition-transform duration-300 group-hover:translate-x-0.5" />
        </button>
        <p className="hud text-center text-[9px] text-ink-faint">Look · Think · Act</p>
      </div>
    </nav>
  );
}
