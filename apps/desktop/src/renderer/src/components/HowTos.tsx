import type { HowTo, HowToStep, HowToStepKind, Task } from "@venom/contracts";
import { useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { findHowTos, savedFrom } from "../howtos-state.ts";
import { sinceWords } from "../move-words.ts";
import type { HowTosState } from "../use-howtos.ts";
import { button } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Trouble } from "./Trouble.tsx";

const kindIcon: Record<HowToStepKind, IconName> = {
  click: "tap",
  type: "keyboard",
  key: "keyboard",
  scroll: "scroll",
  open: "app",
  pause: "pause",
};

const learnedLook: Record<HowTo["learned"], { readonly icon: IconName; readonly word: string }> = {
  show: { icon: "eye", word: "Shown" },
  tell: { icon: "keyboard", word: "Told" },
  job: { icon: "list", word: "From a job" },
};

const hues = [
  "from-green-400/30 to-green-700/10",
  "from-sky-400/30 to-sky-700/10",
  "from-amber-300/30 to-amber-700/10",
  "from-violet-400/30 to-violet-700/10",
  "from-rose-400/30 to-rose-700/10",
] as const;

const glyphs: readonly (readonly [RegExp, IconName])[] = [
  [/calc/iu, "grid"],
  [/edge|chrome|firefox|browser|bing|google/iu, "globe"],
  [/outlook|mail/iu, "mail"],
  [/word|notepad|docs|note/iu, "file"],
  [/weather/iu, "sun"],
];

function looksOf(howto: HowTo): { readonly glyph: IconName; readonly hue: string } {
  const named = `${howto.app ?? ""} ${howto.name}`;
  const glyph = glyphs.find(([pattern]) => pattern.test(named))?.[1] ?? "app";
  const seed = [...named].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return { glyph, hue: hues[seed % hues.length] ?? hues[0] };
}

function lastedWords(seconds: number | null): string | null {
  if (seconds === null) {
    return null;
  }
  return seconds < 60 ? `~${seconds} s` : `~${Math.round(seconds / 60)} min`;
}

function Ring({ howto }: { readonly howto: HowTo }) {
  const share = howto.applied === 0 ? 0 : howto.worked / howto.applied;
  const length = 2 * Math.PI * 15;
  return (
    <span className="relative grid h-11 w-11 place-items-center" title={howto.applied === 0 ? "Not applied yet" : `${howto.worked} of ${howto.applied} worked`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#4dff7c" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${share * length} ${length}`} style={{ filter: "drop-shadow(0 0 4px rgba(31,242,92,0.8))" }} />
      </svg>
      <span className="tabular text-[10.5px] font-bold text-ink">{howto.applied === 0 ? "new" : `${Math.round(share * 100)}%`}</span>
    </span>
  );
}

function StepSwitch({ on, onToggle }: { readonly on: boolean; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      title={on ? "Step by step: VENOM asks before each step" : "Go step by step: VENOM asks before each step"}
      className={`flex h-10 shrink-0 items-center gap-2 rounded-full border px-2.5 transition-colors duration-200 ease-ui ${on ? "border-green-400/55 bg-green-400/[0.1] text-green-300" : "border-line bg-black/35 text-ink-faint hover:text-ink"}`}
    >
      <span className={`relative h-4 w-7 rounded-full transition-colors duration-200 ${on ? "bg-green-400/70 shadow-[0_0_10px_-1px_rgba(31,242,92,0.8)]" : "bg-white/12"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-ink transition-[left] duration-200 ease-ui ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      <span className="hud text-[9px]">Steps</span>
    </button>
  );
}

function ApplyButton({ busy, stepwise, onApply }: { readonly busy: boolean; readonly stepwise: boolean; readonly onApply: () => void }) {
  return (
    <button type="button" disabled={busy} onClick={onApply} title={stepwise ? "Apply, asking before each step" : "Apply this how-to"} className={`${button.primary} min-w-0 flex-1`}>
      <Icon name="play" className="h-3.5 w-3.5" />
      {busy ? "Starting…" : "Apply"}
    </button>
  );
}

function Path({ steps }: { readonly steps: readonly HowToStep[] }) {
  const shown = steps.slice(0, 7);
  return (
    <div className="flex items-center">
      {shown.map((step, index) => (
        <span key={step.number} className="flex items-center">
          {index > 0 && <span className={`h-px w-3.5 ${shown[index - 1]?.note !== null || step.note !== null ? "bg-status-wait/50" : "bg-green-400/35"}`} />}
          <span title={step.said} className={`grid h-7 w-7 place-items-center rounded-full border ${step.note !== null ? "border-status-wait/60 bg-status-wait/10 text-status-wait shadow-[0_0_12px_-2px_rgba(242,196,109,0.7)]" : "border-green-400/35 bg-black/50 text-green-300/90"}`}>
            <Icon name={kindIcon[step.kind]} className="h-3 w-3" />
          </span>
        </span>
      ))}
      {steps.length > shown.length && <span className="tabular ml-1.5 text-[11px] text-ink-faint">+{steps.length - shown.length}</span>}
    </div>
  );
}

interface Applying {
  readonly busy: boolean;
  readonly stepwise: boolean;
  onStepwise(): void;
  onApply(): void;
}

function Tile({ howto, now, run, onOpen, onPin }: { readonly howto: HowTo; readonly now: number; readonly run: Applying; readonly onOpen: () => void; readonly onPin: () => void }) {
  const { glyph, hue } = looksOf(howto);
  const learned = learnedLook[howto.learned];
  const notes = howto.steps.filter((step) => step.note !== null).length;
  const lasted = lastedWords(howto.seconds);

  return (
    <li className="group glass relative flex flex-col gap-4 overflow-hidden rounded-[20px] p-4 transition-[border-color,transform,box-shadow] duration-300 ease-ui hover:-translate-y-0.5 hover:border-green-400/40 hover:shadow-[0_0_40px_-16px_rgba(31,242,92,0.7)]">
      <div className={`pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-radial ${hue} opacity-70 blur-2xl`} />
      <div className="relative flex items-start justify-between gap-3">
        <span className={`grid h-14 w-14 place-items-center rounded-[16px] border border-white/10 bg-linear-to-br ${hue} text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]`}>
          <Icon name={glyph} className="h-6 w-6" />
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPin} aria-pressed={howto.pinned} aria-label={howto.pinned ? "Unpin" : "Pin to the top"} className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${howto.pinned ? "text-green-300" : "text-ink-faint hover:text-ink"}`}>
            <Icon name="memory" className="h-4 w-4" />
          </button>
          <Ring howto={howto} />
        </div>
      </div>
      <button type="button" onClick={onOpen} className="relative flex flex-col gap-1 text-left">
        <span className="line-clamp-2 text-[17px] leading-tight font-semibold text-ink">{howto.name}</span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-faint">
          <Icon name={learned.icon} className="h-3 w-3 text-green-300/70" />
          {[learned.word, howto.app, sinceWords(howto.updated_at, now)].filter((part) => part !== null).join(" · ")}
        </span>
      </button>
      <div className="relative flex items-center justify-between gap-2">
        <Path steps={howto.steps} />
        {lasted !== null && (
          <span className="tabular flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
            <Icon name="hourglass" className="h-3 w-3" />
            {lasted}
          </span>
        )}
      </div>
      <div className="relative mt-auto flex items-center gap-2">
        <ApplyButton busy={run.busy} stepwise={run.stepwise} onApply={run.onApply} />
        <StepSwitch on={run.stepwise} onToggle={run.onStepwise} />
        <button type="button" onClick={onOpen} className={`${button.icon} relative`} aria-label="Steps and notes">
          <Icon name="list" className="h-4 w-4" />
          <span className="tabular absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-green-400 px-1 text-[9.5px] font-bold text-on-accent">{howto.steps.length}</span>
          {notes > 0 && <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-status-wait ring-2 ring-black" />}
        </button>
      </div>
    </li>
  );
}

function NoteBox({ initial, onSave, onCancel }: { readonly initial: string; readonly onSave: (note: string | null) => Promise<void>; readonly onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const cleaned = text.replace(/\s+/gu, " ").trim();

  async function save(note: string | null) {
    setBusy(true);
    await onSave(note);
    setBusy(false);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void save(cleaned === "" ? null : cleaned);
    } else if (event.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKey}
        autoFocus
        rows={2}
        maxLength={300}
        placeholder="When you reach this step, do this instead…"
        className="w-full resize-none rounded-[12px] border border-status-wait/45 bg-black/50 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-status-wait/80"
      />
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={busy} onClick={() => void save(cleaned === "" ? null : cleaned)} className={button.gateApprove}>
          <Icon name="check" className="h-3.5 w-3.5" />
          Save note
        </button>
        {initial !== "" && (
          <button type="button" disabled={busy} onClick={() => void save(null)} className={button.mini}>
            Remove
          </button>
        )}
        <button type="button" onClick={onCancel} className={button.mini}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Sheet({ howto, state, run, onClose }: { readonly howto: HowTo; readonly state: HowTosState; readonly run: Applying; readonly onClose: () => void }) {
  const { glyph, hue } = looksOf(howto);
  const [editing, setEditing] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(howto.name);
  const [forgetting, setForgetting] = useState(false);

  async function rename() {
    const cleaned = name.replace(/\s+/gu, " ").trim();
    if (cleaned !== "" && cleaned !== howto.name && (await state.change(howto.id, { name: cleaned.slice(0, 60) }))) {
      setNaming(false);
    } else if (cleaned === howto.name) {
      setNaming(false);
    }
  }

  async function forget() {
    if (await state.forget(howto.id)) {
      onClose();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside onClick={(event) => event.stopPropagation()} aria-label={howto.name} className="glass-strong m-3 flex w-full max-w-[460px] animate-rise flex-col gap-5 overflow-y-auto rounded-[24px] p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-white/10 bg-linear-to-br ${hue} text-ink`}>
              <Icon name={glyph} className="h-5 w-5" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="hud text-[9px] text-green-300/80">{howto.steps.length} steps</span>
              {naming ? (
                <input
                  value={name}
                  autoFocus
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => void rename()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void rename();
                    } else if (event.key === "Escape") {
                      setName(howto.name);
                      setNaming(false);
                    }
                  }}
                  className="rounded-[8px] border border-green-400/50 bg-black/50 px-2 py-0.5 text-[17px] font-semibold text-ink outline-none"
                />
              ) : (
                <button type="button" onClick={() => setNaming(true)} title="Rename" className="truncate text-left text-[18px] font-semibold text-ink hover:text-green-300">
                  {howto.name}
                </button>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className={button.icon} aria-label="Close">
            <Icon name="cross" className="h-4 w-4" />
          </button>
        </div>
        {state.failure !== null && <Trouble reason={state.failure} />}
        <ol className="flex flex-col">
          {howto.steps.map((step, index) => (
            <li key={step.number} className="relative flex gap-3 pb-4 last:pb-0">
              {index < howto.steps.length - 1 && <span className="absolute top-9 bottom-0 left-[17px] w-px bg-linear-to-b from-green-400/45 to-green-400/5" />}
              <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full border ${step.note !== null ? "border-status-wait/60 bg-status-wait/10 text-status-wait" : "border-green-400/40 bg-black/60 text-green-300"}`}>
                <Icon name={kindIcon[step.kind]} className="h-3.5 w-3.5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1.5">
                <p className="text-[13.5px] leading-snug text-ink">{step.said}</p>
                {editing === step.number ? (
                  <NoteBox
                    initial={step.note ?? ""}
                    onCancel={() => setEditing(null)}
                    onSave={async (note) => {
                      if (await state.note(howto.id, step.number, note)) {
                        setEditing(null);
                      }
                    }}
                  />
                ) : step.note !== null ? (
                  <button type="button" onClick={() => setEditing(step.number)} className="flex items-start gap-2 rounded-[12px] border border-status-wait/40 bg-status-wait/[0.08] px-3 py-2.5 text-left text-[12.5px] leading-snug text-status-wait transition-colors hover:border-status-wait/70">
                    <Icon name="pencil" className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{step.note}</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setEditing(step.number)} className="flex items-center gap-1.5 self-start rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:border-green-400/50 hover:text-green-300">
                    <Icon name="pencil" className="h-3 w-3" />
                    Note
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-auto flex items-center gap-2 border-t border-line-subtle pt-4">
          {forgetting ? (
            <>
              <span className="flex-1 text-[12.5px] text-ink-muted">Forget this how-to for good?</span>
              <button type="button" onClick={() => setForgetting(false)} className={button.gateCancel}>
                Keep it
              </button>
              <button type="button" onClick={() => void forget()} className={button.gateApprove}>
                <Icon name="trash" className="h-3.5 w-3.5 text-status-wait" />
                Forget
              </button>
            </>
          ) : (
            <>
              <ApplyButton busy={run.busy} stepwise={run.stepwise} onApply={run.onApply} />
              <StepSwitch on={run.stepwise} onToggle={run.onStepwise} />
              <button type="button" onClick={() => setNaming(true)} className={button.icon} aria-label="Rename">
                <Icon name="pencil" className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setForgetting(true)} className={`${button.icon} hover:border-red-500/50 hover:text-red-400`} aria-label="Forget">
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function Jobs({ jobs, state, now, onClose }: { readonly jobs: readonly Task[]; readonly state: HowTosState; readonly now: number; readonly onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside onClick={(event) => event.stopPropagation()} aria-label="Save a job" className="glass-strong m-3 flex w-full max-w-[460px] animate-rise flex-col gap-4 overflow-y-auto rounded-[24px] p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="hud text-[9px] text-green-300/80">Save a job</span>
            <span className="text-[18px] font-semibold text-ink">Jobs VENOM finished</span>
          </div>
          <button type="button" onClick={onClose} className={button.icon} aria-label="Close">
            <Icon name="cross" className="h-4 w-4" />
          </button>
        </div>
        {state.failure !== null && <Trouble reason={state.failure} />}
        {jobs.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">Ask VENOM to do something on your computer. Finished jobs show up here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => {
              const saved = savedFrom(state.howtos, job.id);
              const saving = state.saving.has(job.id);
              return (
                <li key={job.id} className="flex items-center gap-3 rounded-[14px] border border-line bg-black/35 p-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-green-400/25 bg-green-400/[0.07] text-green-300">
                    <Icon name="list" className="h-4 w-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-medium text-ink first-letter:uppercase" title={job.request_text}>
                      {job.request_text}
                    </span>
                    <span className="text-[11.5px] text-ink-faint">
                      {job.moves} {job.moves === 1 ? "move" : "moves"} · {sinceWords(job.updated_at, now)}
                    </span>
                  </div>
                  {saved !== null ? (
                    <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-green-300">
                      <Icon name="check" className="h-3.5 w-3.5" />
                      Saved
                    </span>
                  ) : (
                    <button type="button" disabled={saving} onClick={() => void state.save(job.id)} className={button.compact}>
                      <Icon name="sparkle" className="h-3.5 w-3.5" />
                      {saving ? "Saving…" : "Save"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>,
    document.body,
  );
}

const ways: readonly { readonly icon: IconName; readonly title: string; readonly hint: string; readonly ready: boolean }[] = [
  { icon: "eye", title: "Show me", hint: "Do it once live, VENOM watches", ready: false },
  { icon: "keyboard", title: "Tell me", hint: "Type the steps", ready: false },
  { icon: "list", title: "Save a job", hint: "Keep a finished job", ready: true },
];

export function HowTos({ state, jobs, onApplied }: { readonly state: HowTosState; readonly jobs: readonly Task[]; readonly onApplied: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [stepwise, setStepwise] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const now = Date.now();
  const open = state.howtos.find((howto) => howto.id === openId) ?? null;
  const shown = findHowTos(state.howtos, query);

  function run(howto: HowTo): Applying {
    const on = stepwise.has(howto.id);
    return {
      busy: state.applying.has(howto.id),
      stepwise: on,
      onStepwise: () =>
        setStepwise((current) => {
          const next = new Set(current);
          if (on) {
            next.delete(howto.id);
          } else {
            next.add(howto.id);
          }
          return next;
        }),
      onApply: () =>
        void state.apply(howto.id, on).then((started) => {
          if (started) {
            setOpenId(null);
            onApplied();
          }
        }),
    };
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Teach VENOM" className="grid grid-cols-3 gap-2.5">
        {ways.map((way) => (
          <button
            key={way.title}
            type="button"
            title={way.ready ? way.hint : `${way.hint}. Coming in the next updates.`}
            disabled={!way.ready}
            onClick={() => setPicking(true)}
            className={`group relative flex flex-col items-center gap-2.5 overflow-hidden rounded-[18px] border px-3 py-5 transition-[border-color,transform] duration-300 ease-ui ${
              way.ready ? "glass-glow border-green-400/45 hover:-translate-y-0.5" : "glass cursor-default"
            }`}
          >
            {way.ready && <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(31,242,92,0.22),transparent_65%)]" />}
            {!way.ready && <span className="hud absolute top-2.5 right-2.5 rounded-full border border-line px-1.5 py-0.5 text-[7.5px] text-ink-faint">soon</span>}
            <span className={`relative grid h-12 w-12 place-items-center rounded-full border ${way.ready ? "ring-live border-green-400/60 bg-green-400/15 text-green-300 shadow-mark" : "border-line-strong bg-black/50 text-ink-faint"}`}>
              <Icon name={way.icon} className="h-5 w-5" />
            </span>
            <span className={`relative text-[13.5px] font-semibold ${way.ready ? "text-ink" : "text-ink-muted"}`}>{way.title}</span>
          </button>
        ))}
      </section>
      {state.failure !== null && open === null && !picking && <Trouble reason={state.failure} />}
      {state.howtos.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a how-to" className="h-10 w-full rounded-[12px] border border-line bg-black/35 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-green-400/60" />
          </div>
          <span className="hud shrink-0 rounded-full border border-line bg-black/35 px-3 py-2 text-[9px] text-ink-faint">{state.howtos.length} learned</span>
        </div>
      )}
      {state.loaded && state.howtos.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] border border-green-400/25 bg-green-400/[0.06] text-green-300 shadow-mark">
            <Icon name="sparkle" className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-semibold text-ink">No how-tos yet</p>
          <p className="max-w-sm text-[13px] text-ink-muted">Tap Save a job to keep the way VENOM did something.</p>
        </div>
      )}
      {state.howtos.length > 0 && shown.length === 0 && <p className="px-1 text-[13px] text-ink-muted">No how-to matches “{query.trim()}”.</p>}
      {shown.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((howto) => (
            <Tile key={howto.id} howto={howto} now={now} run={run(howto)} onOpen={() => setOpenId(howto.id)} onPin={() => void state.change(howto.id, { pinned: !howto.pinned })} />
          ))}
        </ul>
      )}
      {open !== null && <Sheet key={open.id} howto={open} state={state} run={run(open)} onClose={() => setOpenId(null)} />}
      {picking && <Jobs jobs={jobs} state={state} now={now} onClose={() => setPicking(false)} />}
    </div>
  );
}
