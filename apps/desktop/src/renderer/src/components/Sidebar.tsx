import { mark } from "../ui.ts";
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
    return <span className={`${mark.dot} bg-status-wait`} aria-hidden="true" />;
  }
  if (place === "screen" && signals.working) {
    return <span className={`${mark.dot} animate-pulse bg-status-ok motion-reduce:animate-none`} aria-hidden="true" />;
  }
  return null;
}

export function Sidebar({ current, signals, onChoose }: SidebarProps) {
  return (
    <nav
      aria-label="Places"
      className="flex shrink-0 border-b border-line-subtle min-[960px]:w-[72px] min-[960px]:flex-col min-[960px]:gap-1 min-[960px]:border-r min-[960px]:border-b-0 min-[960px]:p-2 xl:w-[200px]"
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
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[11.5px] font-medium transition-colors duration-140 ease-ui min-[960px]:flex-none min-[960px]:rounded-control min-[960px]:py-2.5 xl:flex-row xl:gap-3 xl:px-3 xl:text-sm ${
              chosen ? "text-green-400 min-[960px]:bg-surface-2" : "text-ink-muted hover:text-ink"
            }`}
          >
            <span className="relative">
              <Icon name={view.icon} className="h-[18px] w-[18px]" />
              <span className="absolute -top-0.5 -right-1.5 xl:hidden">
                <Signal place={place} signals={signals} />
              </span>
            </span>
            <span className="truncate min-[960px]:hidden xl:inline xl:flex-1 xl:text-left">{view.label}</span>
            <span className="hidden xl:inline-flex">
              <Signal place={place} signals={signals} />
            </span>
            {place === "screen" && signals.later > 0 && (
              <span className={`${mark.badge} absolute top-1 right-1 bg-(--tint-accent) text-green-300 xl:static`} aria-hidden="true">
                {signals.later}
              </span>
            )}
            {chosen && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-green-400 min-[960px]:hidden" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}
