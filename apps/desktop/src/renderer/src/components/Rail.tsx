import { text } from "../ui.ts";
import { Emblem } from "./Emblem.tsx";
import { Icon, type IconName } from "./Icon.tsx";

export interface RailProps {
  readonly devicesOnline: number;
  readonly engine: string | null;
  readonly answersLeft: number | null;
  readonly memories: number;
  readonly working: boolean;
  readonly onQuick: (draft: string) => void;
}

const quick: readonly { readonly label: string; readonly icon: IconName; readonly tint: string; readonly draft: string }[] = [
  { label: "Search the web", icon: "globe", tint: "text-sky-300 bg-sky-400/10", draft: "Search the web for " },
  { label: "Check the weather", icon: "sun", tint: "text-amber-300 bg-amber-400/10", draft: "What's the weather today?" },
  { label: "Explore more", icon: "grid", tint: "text-green-300 bg-green-400/10", draft: "What can you do for me, buddy?" },
];

function Heartbeat({ working }: { readonly working: boolean }) {
  return (
    <svg viewBox="0 0 120 32" className="h-8 w-28" aria-hidden="true">
      <polyline points="0,16 30,16 38,16 44,4 52,28 58,12 64,16 120,16" fill="none" stroke="rgba(77,255,124,0.18)" strokeWidth="1.5" />
      <polyline
        points="0,16 30,16 38,16 44,4 52,28 58,12 64,16 120,16"
        fill="none"
        stroke="#4dff7c"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="60 180"
        className={working ? "animate-[pulse-line_1.4s_linear_infinite]" : "animate-pulse-line"}
        style={{ filter: "drop-shadow(0 0 4px rgba(31,242,92,0.9))" }}
      />
    </svg>
  );
}

function Companion({ working }: { readonly working: boolean }) {
  return (
    <section aria-label="VENOM" className="glass-glow relative overflow-hidden rounded-panel p-5">
      <div className="absolute -top-16 -right-16 h-44 w-44 rounded-full bg-green-500/20 blur-3xl" aria-hidden="true" />
      <div className="relative flex items-center gap-4">
        <Emblem size={64} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="neon-text text-[22px] font-extrabold tracking-[0.14em]">VENOM</span>
          <span className="text-[13px] text-ink-muted">Your AI companion</span>
        </div>
      </div>
      <div className="relative mt-4 flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink/80 italic">{working ? "Working on it, buddy…" : "Smart. Fast. Always with you."}</p>
        <Heartbeat working={working} />
      </div>
    </section>
  );
}

function QuickActions({ onQuick }: { readonly onQuick: (draft: string) => void }) {
  return (
    <section aria-label="Quick actions" className="glass rounded-panel p-4">
      <h2 className="mb-3 flex items-center gap-2 px-1 text-[15px] font-semibold text-ink">
        <Icon name="bolt" className="h-4 w-4 text-green-400" />
        Quick Actions
      </h2>
      <ul className="flex flex-col gap-2">
        {quick.map((action) => (
          <li key={action.label}>
            <button
              type="button"
              onClick={() => onQuick(action.draft)}
              className="group flex w-full items-center gap-3 rounded-2xl border border-line-subtle bg-white/[0.025] p-2.5 text-left transition-all duration-300 ease-ui hover:-translate-y-px hover:border-green-400/40 hover:bg-green-400/[0.06] hover:shadow-[0_0_22px_-10px_rgba(31,242,92,0.9)]"
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${action.tint}`}>
                <Icon name={action.icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{action.label}</span>
              <Icon name="arrow" className="h-4 w-4 text-ink-faint transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-green-300" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Status({ devicesOnline, engine, answersLeft, memories }: Omit<RailProps, "onQuick" | "working">) {
  const rows: readonly { readonly icon: IconName; readonly label: string; readonly live: boolean }[] = [
    { icon: "devices", label: `${devicesOnline} ${devicesOnline === 1 ? "device" : "devices"} online`, live: devicesOnline > 0 },
    { icon: "bolt", label: engine === null ? "Model warming up" : answersLeft === null ? `${engine} ready` : `${engine} ready · ~${answersLeft} answers`, live: engine !== null },
    { icon: "chip", label: `Memory active · ${memories} kept`, live: true },
  ];
  return (
    <section aria-label="System status" className="glass relative overflow-hidden rounded-panel p-4">
      <h2 className="mb-3 flex items-center gap-2 px-1 text-[15px] font-semibold text-ink">
        <Icon name="pulse" className="h-4 w-4 text-green-400" />
        System Status
      </h2>
      <ul className="flex flex-col gap-2.5 px-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 text-[13px] text-ink/90">
            <span className={`grid h-6 w-6 place-items-center rounded-lg ${row.live ? "bg-green-400/12 text-green-300" : "bg-white/5 text-ink-faint"}`}>
              <Icon name={row.icon} className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className={`h-1.5 w-1.5 rounded-full ${row.live ? "bg-green-400 shadow-[0_0_8px_2px_rgba(31,242,92,0.8)]" : "bg-status-idle"}`} />
          </li>
        ))}
      </ul>
      <svg viewBox="0 0 280 40" preserveAspectRatio="none" className="mt-3 h-9 w-full" aria-hidden="true">
        <defs>
          <linearGradient id="rail-wave" x1="0" x2="1">
            <stop offset="0%" stopColor="#4dff7c" stopOpacity="0" />
            <stop offset="50%" stopColor="#4dff7c" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#4dff7c" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <path d="M0 30 C40 30 60 28 90 26 S150 30 180 22 S220 6 240 18 S270 30 280 28" fill="none" stroke="url(#rail-wave)" strokeWidth="2" style={{ filter: "drop-shadow(0 0 5px rgba(31,242,92,0.8))" }} />
      </svg>
      <p className={`${text.eyebrow} px-1 text-[9px] text-ink-faint`}>Live · all systems nominal</p>
    </section>
  );
}

export function Rail(props: RailProps) {
  return (
    <aside aria-label="VENOM at a glance" className="hidden w-[320px] shrink-0 flex-col gap-4 overflow-y-auto pb-1 xl:flex">
      <Companion working={props.working} />
      <QuickActions onQuick={props.onQuick} />
      <Status devicesOnline={props.devicesOnline} engine={props.engine} answersLeft={props.answersLeft} memories={props.memories} />
    </aside>
  );
}
