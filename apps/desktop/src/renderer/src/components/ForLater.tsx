import type { LaterItem } from "@venom/contracts";
import { useEffect, useRef, useState } from "react";
import { laterPreview, unseenCount } from "../later-state.ts";
import type { LaterState } from "../use-later.ts";
import { button, mark, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { Markdown } from "./Markdown.tsx";
import { Trouble } from "./Trouble.tsx";

const keptFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const copiedMs = 1500;

function RemoveGate({ item, onCancel, onConfirm }: { readonly item: LaterItem; readonly onCancel: () => void; readonly onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-labelledby={`remove-later-${item.id}`} className="flex flex-col gap-3 border-t border-line-subtle pt-3">
      <p id={`remove-later-${item.id}`} className={text.support}>
        Remove this for good? It disappears from Screen on all your devices.
      </p>
      <div className="flex gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={button.gateCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className={button.gateApprove}>
          <Icon name="warning" className="h-3.5 w-3.5 text-status-wait" />
          <span>Remove</span>
        </button>
      </div>
    </div>
  );
}

function LaterRow({ item, state, onOpenLink }: { readonly item: LaterItem; readonly state: LaterState; readonly onOpenLink: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const unseen = item.seen_at === null;

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), copiedMs);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function toggle() {
    setOpen((shown) => !shown);
    if (!open && unseen) {
      void state.seen(item.id);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(`# ${item.title}\n\n${item.body}`);
    setCopied(true);
  }

  async function remove() {
    setBusy(true);
    const removed = await state.remove(item.id);
    setBusy(false);
    if (!removed) {
      setRemoving(false);
    }
  }

  return (
    <li className={`flex flex-col gap-3 p-4 ${unseen ? surface.cardActive : surface.card}`}>
      <div className="flex min-w-0 items-start gap-2">
        <span className={`${mark.dot} mt-2 ${unseen ? "bg-status-ok" : "bg-transparent"}`} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="break-words font-medium text-ink">{item.title}</span>
          <span className={`${text.detail} text-ink-faint`}>
            {unseen ? "New" : "Seen"} · kept {keptFormat.format(new Date(item.created_at))}
            {item.task_id !== null && " · from a job"}
          </span>
        </div>
      </div>
      {open ? (
        <div className="min-w-0">
          <Markdown source={item.body} onOpenLink={onOpenLink} />
        </div>
      ) : (
        <p className={`line-clamp-2 break-words ${text.support}`}>{laterPreview(item.body)}</p>
      )}
      {removing ? (
        <RemoveGate item={item} onCancel={() => setRemoving(false)} onConfirm={() => void remove()} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggle} aria-expanded={open} className={button.compact}>
            <Icon name="chevron" className={`h-3 w-3 transition-transform duration-140 ease-ui ${open ? "rotate-180" : ""}`} />
            {open ? "Show less" : "Open"}
          </button>
          <button type="button" onClick={() => void copy()} className={button.compact}>
            <Icon name={copied ? "check" : "copy"} />
            {copied ? "Copied" : "Copy"}
          </button>
          {unseen && (
            <button type="button" onClick={() => void state.seen(item.id)} className={button.compact}>
              <Icon name="check" />
              Seen
            </button>
          )}
          <button type="button" onClick={() => setRemoving(true)} disabled={busy} className={button.destructive}>
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

export function ForLater({ state, onOpenLink }: { readonly state: LaterState; readonly onOpenLink: (url: string) => void }) {
  const waiting = unseenCount(state.items);

  return (
    <section aria-label="For later" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-ink">For later</h3>
        {waiting > 0 && <span className={mark.tag}>{waiting} new</span>}
      </div>
      {state.failure !== null && <Trouble reason={state.failure} />}
      {state.loaded && state.items.length === 0 ? (
        <p className={text.support}>Nothing kept for later yet. Add "keep it for later" to a question or a job, and VENOM keeps the answer here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.items.map((item) => (
            <LaterRow key={item.id} item={item} state={state} onOpenLink={onOpenLink} />
          ))}
        </ul>
      )}
    </section>
  );
}
