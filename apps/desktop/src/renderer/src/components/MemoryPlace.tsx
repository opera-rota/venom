import { memoryLimits, type MemoryDraft, type MemoryItem, type MemoryType, type Task } from "@venom/contracts";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { matching, memoryTypes } from "../memory-state.ts";
import { sinceWords } from "../move-words.ts";
import type { HowTosState } from "../use-howtos.ts";
import type { MemoryState } from "../use-memory.ts";
import { button, field, surface, text } from "../ui.ts";
import { Choice } from "./Choice.tsx";
import { HowTos } from "./HowTos.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Place } from "./Place.tsx";
import { Trouble } from "./Trouble.tsx";

const typeView: Record<MemoryType, { readonly label: string; readonly plural: string; readonly hint: string; readonly icon: IconName }> = {
  preference: { label: "Preference", plural: "Preferences", hint: "Shapes every answer", icon: "heart" },
  fact: { label: "Fact", plural: "Facts", hint: "Recalled when it matters", icon: "file" },
  event: { label: "Event", plural: "Events", hint: "Dates and plans", icon: "calendar" },
};

type Filter = MemoryType | "all";

type View = "know" | "howtos";

const count = new Intl.NumberFormat();

function cleaned(content: string): string {
  return content.replace(/\s+/gu, " ").trim();
}

function Draft({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly initial: MemoryDraft;
  readonly submitLabel: string;
  readonly onSubmit: (draft: MemoryDraft) => Promise<boolean>;
  readonly onCancel?: () => void;
}) {
  const [content, setContent] = useState(initial.content);
  const [type, setType] = useState<MemoryType>(initial.type);
  const [busy, setBusy] = useState(false);
  const contentId = useId();
  const length = cleaned(content).length;
  const tooLong = length > memoryLimits.characters;
  const unchanged = cleaned(content) === initial.content && type === initial.type;
  const blocked = length === 0 || tooLong || busy || (onCancel !== undefined && unchanged);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (blocked) {
      return;
    }
    setBusy(true);
    const saved = await onSubmit({ type, content: cleaned(content) });
    setBusy(false);
    if (saved && onCancel === undefined) {
      setContent("");
    }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && onCancel !== undefined) {
      onCancel();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <label htmlFor={contentId} className="sr-only">
        What VENOM should remember
      </label>
      <textarea
        id={contentId}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={onKey}
        rows={1}
        maxLength={memoryLimits.characters * 2}
        placeholder="I prefer metric units and short answers"
        aria-invalid={tooLong}
        autoFocus={onCancel !== undefined}
        className={`${field.input} min-h-11 bg-black/45 text-[14px]`}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Choice label="Kind" value={type} options={memoryTypes.map((option) => ({ value: option, label: typeView[option].label, hint: typeView[option].hint, icon: typeView[option].icon }))} onChange={setType} />
        <div className="flex items-center gap-2">
          {length > memoryLimits.characters * 0.8 && (
            <span className={`tabular text-[11px] ${tooLong ? "text-red-400" : "text-ink-faint"}`}>
              {length}/{memoryLimits.characters}
            </span>
          )}
          {onCancel !== undefined && (
            <button type="button" onClick={onCancel} className={button.ghost}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={blocked} className={onCancel === undefined ? button.primary : button.compact}>
            <Icon name={onCancel === undefined ? "plus" : "check"} className="h-3.5 w-3.5" />
            {busy ? "Saving" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function Capacity({ used, limit }: { readonly used: number; readonly limit: number }) {
  const share = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  return (
    <section aria-label="Memory space" className={`flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 ${surface.card}`}>
      <div className="flex items-baseline gap-2">
        <span className="tabular text-[28px] leading-none font-bold text-ink">{count.format(used)}</span>
        <span className="text-[12.5px] text-ink-faint">of {count.format(limit)} kept</span>
      </div>
      <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-linear-to-r from-green-600 to-green-400 shadow-[0_0_12px_rgba(31,242,92,0.7)]" style={{ width: `${Math.max(share, used > 0 ? 2 : 0)}%` }} />
        </div>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-faint">
          <Icon name="shield" className="h-3 w-3 text-green-300/70" />
          Only what you ask. Forget means gone for good.
        </span>
      </div>
    </section>
  );
}

function Filters({ items, filter, onFilter }: { readonly items: readonly MemoryItem[]; readonly filter: Filter; readonly onFilter: (filter: Filter) => void }) {
  const tabs: readonly { readonly value: Filter; readonly label: string; readonly total: number }[] = [
    { value: "all", label: "All", total: items.length },
    ...memoryTypes.map((type) => ({ value: type, label: typeView[type].plural, total: items.filter((item) => item.type === type).length })),
  ];
  return (
    <div role="tablist" aria-label="Kinds of memory" className="flex shrink-0 gap-1 rounded-[12px] border border-line bg-black/35 p-1">
      {tabs.map((tab) => {
        const chosen = tab.value === filter;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={chosen}
            onClick={() => onFilter(tab.value)}
            className={`flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-200 ease-ui ${
              chosen ? "bg-green-400/[0.12] text-green-300 shadow-[inset_0_0_0_1px_rgba(77,255,124,0.35)]" : "text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
            <span className={`tabular text-[10.5px] ${chosen ? "text-green-300/80" : "text-ink-faint"}`}>{tab.total}</span>
          </button>
        );
      })}
    </div>
  );
}

function ForgetGate({ item, onCancel, onConfirm }: { readonly item: MemoryItem; readonly onCancel: () => void; readonly onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-labelledby={`forget-${item.id}`} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3">
      <p id={`forget-${item.id}`} className={text.support}>
        {item.source === "chat" ? "Forget this and the chat where you said it? This cannot be undone." : "Forget this for good? This cannot be undone."}
      </p>
      <div className="flex gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={button.gateCancel}>
          Keep it
        </button>
        <button type="button" onClick={onConfirm} className={button.gateApprove}>
          <Icon name="trash" className="h-3.5 w-3.5 text-status-wait" />
          <span>Forget</span>
        </button>
      </div>
    </div>
  );
}

function MemoryRow({ item, state }: { readonly item: MemoryItem; readonly state: MemoryState }) {
  const [mode, setMode] = useState<"view" | "edit" | "forget">("view");
  const [busy, setBusy] = useState(false);
  const view = typeView[item.type];

  async function forget() {
    setBusy(true);
    const forgotten = await state.forget(item.id);
    setBusy(false);
    if (!forgotten) {
      setMode("view");
    }
  }

  async function edit(draft: MemoryDraft) {
    const saved = await state.edit(item.id, draft);
    if (saved) {
      setMode("view");
    }
    return saved;
  }

  if (mode === "edit") {
    return (
      <li className={`p-4 ${surface.cardActive}`}>
        <Draft initial={{ type: item.type, content: item.content }} submitLabel="Save" onSubmit={edit} onCancel={() => setMode("view")} />
      </li>
    );
  }

  return (
    <li className={`group px-4 py-3.5 transition-colors duration-200 ease-ui hover:border-line-strong ${surface.card}`}>
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-green-400/20 bg-green-400/[0.07] text-green-300">
          <Icon name={view.icon} className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="break-words text-[14px] leading-snug text-ink">{item.content}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-faint">
            <span className="hud text-[8.5px] text-green-300/70">{view.label}</span>
            <span>{item.source === "chat" ? "From chat" : "Added here"}</span>
            <span>·</span>
            <span>{sinceWords(item.updated_at, Date.now())}</span>
          </span>
        </div>
        {mode === "view" && (
          <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity duration-200 group-hover:opacity-100">
            <button type="button" onClick={() => setMode("edit")} className={button.icon} aria-label={`Edit: ${item.content}`}>
              <Icon name="pencil" className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setMode("forget")} disabled={busy} className={`${button.icon} hover:border-red-500/50 hover:text-red-400`} aria-label={`Forget: ${item.content}`}>
              <Icon name="trash" className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {mode === "forget" && <ForgetGate item={item} onCancel={() => setMode("view")} onConfirm={() => void forget()} />}
    </li>
  );
}

function Tabs({ view, known, learned, onView }: { readonly view: View; readonly known: number; readonly learned: number; readonly onView: (view: View) => void }) {
  const tabs: readonly { readonly value: View; readonly icon: IconName; readonly label: string; readonly total: number }[] = [
    { value: "know", icon: "memory", label: "Things I know", total: known },
    { value: "howtos", icon: "sparkle", label: "How-tos", total: learned },
  ];
  return (
    <div role="tablist" aria-label="Memory" className="grid grid-cols-2 gap-1 rounded-[14px] border border-line bg-black/40 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={view === tab.value}
          onClick={() => onView(tab.value)}
          className={`flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-[13.5px] font-semibold transition-colors duration-200 ease-ui ${
            view === tab.value ? "bg-green-400/[0.12] text-green-300 shadow-[inset_0_0_0_1px_rgba(77,255,124,0.4),0_0_20px_-8px_rgba(31,242,92,0.7)]" : "text-ink-muted hover:text-ink"
          }`}
        >
          <Icon name={tab.icon} className="h-4 w-4" />
          {tab.label}
          <span className="tabular text-[11px] opacity-70">{tab.total}</span>
        </button>
      ))}
    </div>
  );
}

function Known({ state }: { readonly state: MemoryState }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const searchId = useId();
  const found = matching(state.items, query);
  const shown = filter === "all" ? found : found.filter((item) => item.type === filter);
  const full = state.items.length >= state.limit;
  const searching = query.trim() !== "";

  return (
    <>
      <Capacity used={state.items.length} limit={state.limit} />

      {full ? (
        <p className="flex items-start gap-1.5 text-[13px] text-status-wait">
          <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Memory is full. Forget something to make room.</span>
        </p>
      ) : (
        <section aria-label="Add a memory" className={`p-4 ${surface.cardActive}`}>
          <Draft initial={{ type: "fact", content: "" }} submitLabel="Remember" onSubmit={state.add} />
        </section>
      )}

      {state.failure !== null && <Trouble reason={state.failure} />}

      {state.items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Filters items={found} filter={filter} onFilter={setFilter} />
          <div className="relative min-w-[180px] flex-1">
            <label htmlFor={searchId} className="sr-only">
              Search memory
            </label>
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className={`${field.text} h-10 bg-black/35 py-0 pl-9`} />
          </div>
        </div>
      )}

      {state.loaded && state.items.length === 0 && (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] border border-green-400/25 bg-green-400/[0.06] text-green-300 shadow-mark">
            <Icon name="memory" className="h-6 w-6" />
          </span>
          <p className="text-[15px] font-semibold text-ink">Nothing kept yet</p>
          <p className={`max-w-sm ${text.support}`}>
            Say <span className="text-green-300">“Remember that…”</span> in Chat, or add it above.
          </p>
        </div>
      )}

      {state.items.length > 0 && shown.length === 0 && (
        <p className={`px-1 ${text.support}`}>{searching ? `Nothing here matches “${query.trim()}”.` : `No ${filter === "all" ? "memories" : typeView[filter].plural.toLowerCase()} yet.`}</p>
      )}

      {shown.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <MemoryRow key={item.id} item={item} state={state} />
          ))}
        </ul>
      )}
    </>
  );
}

export interface MemoryPlaceProps {
  readonly state: MemoryState;
  readonly howtos: HowTosState;
  readonly jobs: readonly Task[];
  readonly onApplied: () => void;
}

export function MemoryPlace({ state, howtos, jobs, onApplied }: MemoryPlaceProps) {
  const [view, setView] = useState<View>("know");

  return (
    <Place title="Memory" eyebrow="What I keep" icon="memory" count={state.items.length > 0 ? state.items.length : undefined} width="wide">
      <Tabs view={view} known={state.items.length} learned={howtos.howtos.length} onView={setView} />
      {view === "know" ? <Known state={state} /> : <HowTos state={howtos} jobs={jobs} onApplied={onApplied} />}
    </Place>
  );
}
