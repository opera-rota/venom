import type { Engine, EngineClass, PowerStatus, Proficiency } from "@venom/contracts";
import type { PowerState } from "../use-power.ts";
import { button, field, mark, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const classView: Record<EngineClass, { readonly title: string; readonly blurb: string }> = {
  free: { title: "Free engines", blurb: "No power needed. A set number of answers every day." },
  swift: { title: "Swift engines", blurb: "Fast and light. Each answer spends a little power." },
  titan: { title: "Titan engines", blurb: "The strongest thinkers. Each answer spends the most power." },
};

const classOrder: readonly EngineClass[] = ["free", "swift", "titan"];

const skills: readonly { readonly key: keyof Proficiency; readonly label: string }[] = [
  { key: "thinking", label: "Thinking" },
  { key: "coding", label: "Coding" },
  { key: "writing", label: "Writing" },
  { key: "speed", label: "Speed" },
  { key: "long_memory", label: "Long memory" },
];

const levels = [1, 2, 3, 4, 5] as const;

const count = new Intl.NumberFormat();

const resetTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function engineName(engines: readonly Engine[], power: PowerStatus): string {
  return engines.find((engine) => engine.id === power.engine)?.name ?? power.engine.charAt(0).toUpperCase() + power.engine.slice(1);
}

function Levels({ proficiency }: { readonly proficiency: Proficiency }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
      {skills.map(({ key, label }) => (
        <div key={key} className="contents">
          <dt className={`${text.detail} text-ink-muted`}>{label}</dt>
          <dd className="flex gap-1" aria-label={`${label} ${proficiency[key]} of 5`}>
            {levels.map((level) => (
              <span key={level} className={`h-1.5 flex-1 rounded-full ${level <= proficiency[key] ? "bg-mint-200" : "bg-line"}`} />
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Meter({ power, name }: { readonly power: PowerStatus; readonly name: string }) {
  const free = power.engine_class === "free";
  const freeLeft = Math.max(0, power.free_daily_answers - power.free_used_today);
  const share = power.free_daily_answers === 0 ? 0 : freeLeft / power.free_daily_answers;
  const empty = !free && power.balance <= 0;

  return (
    <section aria-label="Power meter" className={`p-4 ${surface.card}`}>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className={`${text.detail} text-ink-muted`}>Power left</span>
          <span className={`tabular ${text.title} text-ink`}>{count.format(power.balance)}</span>
        </div>
        <span className={mark.tag}>
          <Icon name="bolt" className="mr-1 h-3 w-3" />
          {name}
        </span>
      </div>

      {free ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className={text.support}>
            <span className="tabular text-green-400">
              {freeLeft} of {power.free_daily_answers}
            </span>{" "}
            free answers left today
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="presentation">
            <div className="h-full rounded-full bg-mint-200" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <p className={`${text.detail} text-ink-faint`}>They come back at {resetTime.format(new Date(power.free_resets_at))}.</p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-1.5">
          <p className={text.support}>
            About <span className="tabular text-green-400">{count.format(power.answers_left)}</span> answers left with {name}
          </p>
          <p className={`${text.detail} text-ink-faint`}>Counted from what your answers really cost. Free engines still have {freeLeft} answers today.</p>
          {empty && (
            <p className="flex items-start gap-1.5 text-[13px] text-status-wait">
              <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Out of power. Choose a free engine to keep talking.</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function EngineCard({
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
    <li className={`p-4 ${current ? surface.cardActive : surface.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-ink">{engine.name}</span>
          <span className={text.support}>{engine.tagline}</span>
          <span className={`${text.detail} text-ink-faint`}>
            {engine.class === "free" ? "Free" : `About ${count.format(engine.typical_power)} power per answer`}
          </span>
        </div>
        {current ? (
          <span className={mark.tag}>In use</span>
        ) : (
          <button type="button" onClick={onChoose} disabled={busy} className={button.compact} aria-label={`Use ${engine.name}`}>
            {busy ? "Switching" : "Use"}
          </button>
        )}
      </div>
      <Levels proficiency={engine.proficiency} />
    </li>
  );
}

export function PowerPanel({ state, onClose }: { readonly state: PowerState; readonly onClose: () => void }) {
  const { power, engines, choosing, failure, choose } = state;

  return (
    <aside aria-label="Power" className={`flex w-[360px] max-w-full shrink-0 flex-col ${surface.panel}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className={`flex items-center gap-2 ${text.section}`}>
          <Icon name="bolt" className="h-4 w-4 text-green-400" />
          Power
        </h2>
        <button type="button" onClick={onClose} className={button.ghost} aria-label="Close power">
          <Icon name="cross" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {power !== null && <Meter power={power} name={engineName(engines, power)} />}
        {failure !== null && (
          <p role="alert" className={field.error}>
            <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{failure}</span>
          </p>
        )}
        {classOrder.map((engineClass) => {
          const group = engines.filter((engine) => engine.class === engineClass);
          if (group.length === 0) {
            return null;
          }
          return (
            <section key={engineClass} aria-label={classView[engineClass].title} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5 px-1">
                <h3 className="text-sm font-semibold text-ink">{classView[engineClass].title}</h3>
                <p className={text.support}>{classView[engineClass].blurb}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {group.map((engine) => (
                  <EngineCard
                    key={engine.id}
                    engine={engine}
                    current={power?.engine === engine.id}
                    busy={choosing !== null}
                    onChoose={() => void choose(engine.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
