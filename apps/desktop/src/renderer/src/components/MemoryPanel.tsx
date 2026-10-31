import { memoryLimits, type MemoryDraft, type MemoryItem, type MemoryType } from "@venom/contracts";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { matching, memoryTypes } from "../memory-state.ts";
import type { MemoryState } from "../use-memory.ts";
import { button, field, mark, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const typeView: Record<MemoryType, { readonly label: string; readonly title: string; readonly blurb: string }> = {
  preference: { label: "Preference", title: "Preferences", blurb: "Used in every answer." },
  fact: { label: "Fact", title: "Facts", blurb: "Recalled when they matter." },
  event: { label: "Event", title: "Events", blurb: "Dates and plans, recalled when they matter." },
};

const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const count = new Intl.NumberFormat();

function cleaned(content: string): string {
  return content.replace(/\s+/gu, " ").trim();
}

function Draft({
  initial,
  submitLabel,
  primary,
  onSubmit,
  onCancel,
}: {
  readonly initial: MemoryDraft;
  readonly submitLabel: string;
  readonly primary: boolean;
  readonly onSubmit: (draft: MemoryDraft) => Promise<boolean>;
  readonly onCancel?: () => void;
}) {
  const [content, setContent] = useState(initial.content);
  const [type, setType] = useState<MemoryType>(initial.type);
  const [busy, setBusy] = useState(false);
  const contentId = useId();
  const typeId = useId();
  const length = cleaned(content).length;
  const tooLong = length > memoryLimits.characters;
  const unchanged = cleaned(content) === initial.content && type === initial.type;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (length === 0 || tooLong || busy) {
      return;
    }
    setBusy(true);
    const saved = await onSubmit({ type, content: cleaned(content) });
    setBusy(false);
    if (saved && onCancel === undefined) {
      setContent("");
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <label htmlFor={contentId} className="sr-only">
        What VENOM should remember
      </label>
      <textarea
        id={contentId}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        maxLength={memoryLimits.characters * 2}
        placeholder="Something VENOM should remember about you"
        aria-invalid={tooLong}
        className={field.input}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor={typeId} className="sr-only">
            Kind of memory
          </label>
          <select id={typeId} value={type} onChange={(event) => setType(event.target.value as MemoryType)} className={`${field.text} w-auto py-2`}>
            {memoryTypes.map((option) => (
              <option key={option} value={option}>
                {typeView[option].label}
              </option>
            ))}
          </select>
          <span className={`tabular ${text.detail} ${tooLong ? "text-red-400" : "text-ink-faint"}`}>
            {length}/{memoryLimits.characters}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onCancel !== undefined && (
            <button type="button" onClick={onCancel} className={button.ghost}>
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={length === 0 || tooLong || busy || (onCancel !== undefined && unchanged)}
            className={primary ? button.primary : button.compact}
          >
            {busy ? "Saving" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function ForgetGate({ item, onCancel, onConfirm }: { readonly item: MemoryItem; readonly onCancel: () => void; readonly onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-labelledby={`forget-${item.id}`} className="mt-3 flex flex-col gap-3 border-t border-line-subtle pt-3">
      <p id={`forget-${item.id}`} className={text.support}>
        {item.source === "chat"
          ? "Forget this for good? I delete it, together with the chat message where you told me and my reply. This cannot be undone."
          : "Forget this for good? I delete it and will not use it again. This cannot be undone."}
      </p>
      <div className="flex gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={button.gateCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className={button.gateApprove}>
          <Icon name="warning" className="h-3.5 w-3.5 text-status-wait" />
          <span>Forget</span>
        </button>
      </div>
    </div>
  );
}

function MemoryRow({ item, state }: { readonly item: MemoryItem; readonly state: MemoryState }) {
  const [mode, setMode] = useState<"view" | "edit" | "forget">("view");
  const [busy, setBusy] = useState(false);

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
      <li className={`p-3 ${surface.cardActive}`}>
        <Draft initial={{ type: item.type, content: item.content }} submitLabel="Save" primary={false} onSubmit={edit} onCancel={() => setMode("view")} />
      </li>
    );
  }

  return (
    <li className={`p-3 ${surface.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="break-words text-sm text-ink">{item.content}</span>
          <span className={`${text.detail} text-ink-faint`}>
            {item.source === "chat" ? "Told in chat" : "Added here"} · {savedFormat.format(new Date(item.updated_at))}
          </span>
        </div>
        {mode === "view" && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setMode("edit")} className={button.ghost} aria-label={`Edit: ${item.content}`}>
              Edit
            </button>
            <button type="button" onClick={() => setMode("forget")} disabled={busy} className={button.destructive}>
              Forget
            </button>
          </div>
        )}
      </div>
      {mode === "forget" && <ForgetGate item={item} onCancel={() => setMode("view")} onConfirm={() => void forget()} />}
    </li>
  );
}

export function MemoryPanel({ state, onClose }: { readonly state: MemoryState; readonly onClose: () => void }) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const shown = matching(state.items, query);
  const full = state.items.length >= state.limit;

  return (
    <aside aria-label="Memory" className={`flex w-[380px] max-w-full shrink-0 flex-col ${surface.panel}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className={`flex items-center gap-2 ${text.section}`}>
          <Icon name="memory" className="h-4 w-4 text-green-400" />
          Memory
        </h2>
        <button type="button" onClick={onClose} className={button.ghost} aria-label="Close memory">
          <Icon name="cross" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className={text.support}>
          I only keep what you ask me to. Start a message with "Remember that…", or add it here.{" "}
          <span className="tabular text-green-400">
            {count.format(state.items.length)} of {count.format(state.limit)}
          </span>{" "}
          kept.
        </p>

        {full ? (
          <p className="flex items-start gap-1.5 text-[13px] text-status-wait">
            <Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>My memory is full. Forget something before adding more.</span>
          </p>
        ) : (
          <section aria-label="Add a memory" className={`p-3 ${surface.card}`}>
            <Draft initial={{ type: "fact", content: "" }} submitLabel="Remember" primary onSubmit={state.add} />
          </section>
        )}

        {state.failure !== null && (
          <p role="alert" className={field.error}>
            <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{state.failure}</span>
          </p>
        )}

        {state.items.length > 0 && (
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search memory
            </label>
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search what I remember"
              className={`${field.text} pl-9`}
            />
          </div>
        )}

        {state.loaded && state.items.length === 0 && (
          <div className="flex flex-col gap-1 px-1 py-6 text-center">
            <p className="font-medium text-ink">Nothing remembered yet</p>
            <p className={text.support}>Tell me "Remember that I prefer metric units", or add something above.</p>
          </div>
        )}

        {state.items.length > 0 && shown.length === 0 && <p className={`px-1 ${text.support}`}>Nothing I remember matches "{query.trim()}".</p>}

        {memoryTypes.map((type) => {
          const group = shown.filter((item) => item.type === type);
          if (group.length === 0) {
            return null;
          }
          return (
            <section key={type} aria-label={typeView[type].title} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3 className="text-sm font-semibold text-ink">{typeView[type].title}</h3>
                <span className={mark.tag}>{group.length}</span>
              </div>
              <p className={`px-1 ${text.support}`}>{typeView[type].blurb}</p>
              <ul className="flex flex-col gap-2">
                {group.map((item) => (
                  <MemoryRow key={item.id} item={item} state={state} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
