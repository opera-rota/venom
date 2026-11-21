import { useId, useState } from "react";
import type { Engine, EngineClass, PowerStatus, Proficiency } from "@venom/contracts";
import type { PowerState } from "../use-power.ts";
import { button, field, text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Place } from "./Place.tsx";

interface ClassView {
  readonly title: string;
  readonly short: string;
  readonly blurb: string;
  readonly icon: IconName;
}

const classView: Record<EngineClass, ClassView> = {
  free: { title: "Free engines", short: "Free", blurb: "No power needed. A set number of answers every day.", icon: "sparkle" },
  swift: { title: "Swift engines", short: "Swift", blurb: "Fast and light. Each answer spends a little power.", icon: "bolt" },
  titan: { title: "Titan engines", short: "Titan", blurb: "The strongest thinkers. Each answer spends the most power.", icon: "chip" },
};

const classOrder: readonly EngineClass[] = ["free", "swift", "titan"];

const skills: readonly { readonly key: keyof Proficiency; readonly label: string }[] = [
  { key: "thinking", label: "Thinking" },
  { key: "coding", label: "Coding" },
  { key: "writing", label: "Writing" },
  { key: "speed", label: "Speed" },
  { key: "long_memory", label: "Memory" },
];

const count = new Intl.NumberFormat();

const resetTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function engineName(engines: readonly Engine[], power: PowerStatus): string {
  return engines.find((engine) => engine.id === power.engine)?.name ?? power.engine.charAt(0).toUpperCase() + power.engine.slice(1);
}

function corner(index: number, radius: number): readonly [number, number] {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / skills.length;
  return [60 + radius * Math.cos(angle), 60 + radius * Math.sin(angle)];
}

function shape(radius: (index: number) => number): string {
  return skills.map((_, index) => corner(index, radius(index)).join(",")).join(" ");
}

function Radar({ proficiency, live }: { readonly proficiency: Proficiency; readonly live: boolean }) {
  const id = useId();
  const fill = `${id}-fill`;
  const summary = skills.map(({ key, label }) => `${label} ${proficiency[key]} of 5`).join(", ");

  return (
    <figure className="relative mx-auto w-full max-w-[190px]" role="img" aria-label={summary}>
      <svg viewBox="-14 -6 148 132" className="w-full overflow-visible">
        <defs>
          <radialGradient id={fill} cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#c2ffdb" stopOpacity={live ? 0.55 : 0.4} />
            <stop offset="100%" stopColor="#1ff25c" stopOpacity={live ? 0.28 : 0.14} />
          </radialGradient>
        </defs>
        {[1, 2, 3, 4, 5].map((ring) => (
          <polygon key={ring} points={shape(() => ring * 9)} fill="none" stroke="rgba(120,255,160,0.12)" strokeWidth={ring === 5 ? 1 : 0.6} />
        ))}
        {skills.map((skill, index) => {
          const [x, y] = corner(index, 45);
          return <line key={skill.key} x1={60} y1={60} x2={x} y2={y} stroke="rgba(120,255,160,0.1)" strokeWidth={0.6} />;
        })}
        <polygon
          points={shape((index) => proficiency[skills[index]!.key] * 9)}
          fill={`url(#${fill})`}
          stroke="#4dff7c"
          strokeWidth={1.4}
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(31,242,92,0.7))" }}
        />
        {skills.map((skill, index) => {
          const [x, y] = corner(index, proficiency[skill.key] * 9);
          return <circle key={skill.key} cx={x} cy={y} r={2.1} fill="#effff3" />;
        })}
        {skills.map((skill, index) => {
          const [x, y] = corner(index, 57);
          return (
            <text key={skill.key} x={x} y={y + 3} textAnchor={x < 55 ? "end" : x > 65 ? "start" : "middle"} className="fill-ink-faint font-mono text-[7.5px] uppercase tracking-[0.12em]">
              {skill.label}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

function Reactor({ share, value, unit }: { readonly share: number; readonly value: string; readonly unit: string }) {
  const id = useId();
  const arc = `${id}-arc`;
  const length = 2 * Math.PI * 84;

  return (
    <div className="relative grid h-[200px] w-[200px] shrink-0 place-items-center">
      <span className="absolute inset-6 animate-breathe rounded-full bg-green-500/15 blur-2xl" aria-hidden="true" />
      <svg viewBox="0 0 200 200" className="absolute inset-0" aria-hidden="true">
        <defs>
          <linearGradient id={arc} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c2ffdb" />
            <stop offset="60%" stopColor="#4dff7c" />
            <stop offset="100%" stopColor="#0fc443" />
          </linearGradient>
        </defs>
        <circle cx={100} cy={100} r={96} fill="none" stroke="rgba(120,255,160,0.18)" strokeWidth={1} strokeDasharray="1 5" />
        <circle cx={100} cy={100} r={84} fill="none" stroke="rgba(120,255,160,0.08)" strokeWidth={10} />
        <circle
          cx={100}
          cy={100}
          r={84}
          fill="none"
          stroke={`url(#${arc})`}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${length * share} ${length}`}
          transform="rotate(-90 100 100)"
          className="transition-[stroke-dasharray] duration-700 ease-ui"
          style={{ filter: "drop-shadow(0 0 8px rgba(31,242,92,0.8))" }}
        />
        <g className="origin-center animate-spin-slow">
          <circle cx={100} cy={100} r={68} fill="none" stroke="rgba(120,255,160,0.25)" strokeWidth={1} strokeDasharray="30 12 4 12" />
        </g>
      </svg>
      <div className="relative flex flex-col items-center gap-0.5">
        <span className="tabular neon-text text-[34px] leading-none font-semibold">{value}</span>
        <span className="hud text-[9.5px] text-ink-muted">{unit}</span>
      </div>
    </div>
  );
}

function Readout({ label, value, tone = "ink" }: { readonly label: string; readonly value: string; readonly tone?: "ink" | "green" | "wait" }) {
  const color = tone === "green" ? "text-green-300" : tone === "wait" ? "text-status-wait" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-control border border-line-subtle bg-black/25 px-3 py-2.5 sm:px-4 sm:py-3">
      <dt className="hud truncate text-[8.5px] text-ink-faint sm:text-[9.5px]">{label}</dt>
      <dd className={`tabular whitespace-nowrap text-[13px] font-semibold sm:text-[17px] ${color}`}>{value}</dd>
    </div>
  );
}

function Core({ power, name }: { readonly power: PowerStatus; readonly name: string }) {
  const free = power.engine_class === "free";
  const freeLeft = Math.max(0, power.free_daily_answers - power.free_used_today);
  const share = power.free_daily_answers === 0 ? 0 : freeLeft / power.free_daily_answers;
  const empty = !free && power.balance <= 0;

  return (
    <section aria-label="Power core" className="glass-glow relative overflow-hidden rounded-panel p-5 sm:p-6">
      <span className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-green-500/10 blur-3xl" aria-hidden="true" />
      <div className="relative flex flex-col items-center gap-6 md:flex-row md:items-center">
        <Reactor
          share={free ? share : empty ? 0 : 1}
          value={free ? `${freeLeft}` : count.format(power.answers_left)}
          unit={free ? "free answers today" : "answers left"}
        />
        <div className="flex w-full min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="hud text-[10px] text-green-300/80">Engine in use</span>
            <span className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-ink">
              <span className="grid h-8 w-8 place-items-center rounded-full border border-green-400/40 bg-green-400/10 shadow-mark">
                <Icon name={classView[power.engine_class].icon} className="h-4 w-4 text-green-300" />
              </span>
              {name}
              <span className="hud rounded-full border border-green-400/30 px-2 py-0.5 text-[9px] text-green-300">{classView[power.engine_class].short}</span>
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-2.5">
            <Readout label="Power" value={count.format(power.balance)} tone={empty ? "wait" : "ink"} />
            <Readout label="Free" value={`${freeLeft} / ${power.free_daily_answers}`} tone="green" />
            <Readout label="Refill" value={resetTime.format(new Date(power.free_resets_at))} />
          </dl>
          {empty ? (
            <p className="flex items-start gap-2 text-[13px] text-status-wait">
              <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Out of power. Choose a free engine to keep talking.</span>
            </p>
          ) : (
            <p className={`${text.detail} text-ink-faint`}>
              {free ? "Free engines need no power. Your answers come back every day." : "Counted from what your answers really cost."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ClassSwitch({ chosen, available, onChoose }: { readonly chosen: EngineClass; readonly available: readonly EngineClass[]; readonly onChoose: (value: EngineClass) => void }) {
  return (
    <div role="tablist" aria-label="Engine classes" className="glass flex w-full gap-1 rounded-full p-1 sm:w-fit">
      {available.map((engineClass) => {
        const active = engineClass === chosen;
        return (
          <button
            key={engineClass}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChoose(engineClass)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-2 text-[13px] font-medium transition-[color,background-color,box-shadow] duration-300 ease-ui sm:flex-none ${
              active ? "bg-linear-to-b from-green-400/25 to-green-600/10 text-green-300 shadow-glow" : "text-ink-muted hover:text-ink"
            }`}
          >
            <Icon name={classView[engineClass].icon} className="h-3.5 w-3.5" />
            {classView[engineClass].short}
          </button>
        );
      })}
    </div>
  );
}

function EngineTile({
  engine,
  current,
  busy,
  onChoose,
}: {
  readonly engine: Engine;
  readonly current: boolean;
  readonly busy: boolean;
  readonly onChoose: () => void;
}) {
  return (
    <li className={`group relative flex animate-rise flex-col gap-3 overflow-hidden rounded-panel p-5 transition-transform duration-300 ease-ui hover:-translate-y-0.5 ${current ? "glass-glow ring-live" : "glass"}`}>
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-green-300/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="hud text-[9px] text-ink-faint">{classView[engine.class].short} class</span>
          <span className={`text-lg font-semibold tracking-tight ${current ? "neon-text" : "text-ink"}`}>{engine.name}</span>
          <span className={text.support}>{engine.tagline}</span>
        </div>
        {current && (
          <span className="hud flex shrink-0 items-center gap-1.5 rounded-full border border-green-400/40 bg-green-400/10 px-2.5 py-1 text-[9px] text-green-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            Live
          </span>
        )}
      </div>
      <Radar proficiency={engine.proficiency} live={current} />
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line-subtle pt-3">
        <span className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <Icon name="bolt" className="h-3 w-3 text-green-400" />
          {engine.class === "free" ? "No power needed" : `About ${count.format(engine.typical_power)} per answer`}
        </span>
        {current ? (
          <span className="text-[12px] font-medium text-green-300">Thinking with this</span>
        ) : (
          <button type="button" onClick={onChoose} disabled={busy} className={button.gateApprove} aria-label={`Use ${engine.name}`}>
            {busy ? "Switching" : "Use"}
            {!busy && <Icon name="arrow" className="h-3 w-3" />}
          </button>
        )}
      </div>
    </li>
  );
}

export function ModelsPlace({ state }: { readonly state: PowerState }) {
  const { power, engines, choosing, failure, choose } = state;
  const available = classOrder.filter((engineClass) => engines.some((engine) => engine.class === engineClass));
  const [picked, setPicked] = useState<EngineClass | null>(null);
  const chosen = picked ?? power?.engine_class ?? available[0] ?? "free";
  const group = engines.filter((engine) => engine.class === chosen);

  return (
    <Place title="Models" eyebrow="Brain core" icon="bolt" width="wide">
      <p className={text.support}>The engine VENOM thinks with, and the power you have left.</p>
      {power !== null && <Core power={power} name={engineName(engines, power)} />}
      {failure !== null && (
        <p role="alert" className={field.error}>
          <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{failure}</span>
        </p>
      )}
      {available.length > 0 && (
        <section aria-label={classView[chosen].title} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ClassSwitch chosen={chosen} available={available} onChoose={setPicked} />
            <p className={`${text.support} sm:text-right`}>{classView[chosen].blurb}</p>
          </div>
          <ul key={chosen} className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {group.map((engine) => (
              <EngineTile key={engine.id} engine={engine} current={power?.engine === engine.id} busy={choosing !== null} onChoose={() => void choose(engine.id)} />
            ))}
          </ul>
        </section>
      )}
    </Place>
  );
}
