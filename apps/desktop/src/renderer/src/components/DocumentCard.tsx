import type { ChatDocument } from "@venom/contracts";
import { useEffect, useState } from "react";
import type { SaveResult } from "../../../shared/bridge.ts";
import { button, field, mark, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { Markdown } from "./Markdown.tsx";

const previewLines = 6;
const copiedMs = 1500;

type Note = { readonly kind: "saved"; readonly name: string } | { readonly kind: "failed"; readonly reason: string };

export interface DocumentCardProps {
  readonly document: ChatDocument;
  readonly onOpenLink: (url: string) => void;
  readonly onSave: (document: ChatDocument) => Promise<SaveResult>;
}

export function DocumentCard({ document, onOpenLink, onSave }: DocumentCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const lines = document.body.split("\n");
  const longer = lines.length > previewLines;
  const shown = open || !longer ? document.body : lines.slice(0, previewLines).join("\n");

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), copiedMs);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(`# ${document.title}\n\n${document.body}`);
    setCopied(true);
  }

  async function save() {
    setSaving(true);
    setNote(null);
    const result = await onSave(document);
    setSaving(false);
    if (!result.ok) {
      setNote({ kind: "failed", reason: result.reason });
    } else if (result.saved !== null) {
      setNote({ kind: "saved", name: result.saved });
    }
  }

  return (
    <section aria-label={`Document: ${document.title}`} className="mt-3 flex flex-col gap-3 rounded-control border border-line bg-surface-2 p-4">
      <div className="flex min-w-0 items-center gap-2">
        <Icon name="file" className="h-4 w-4 shrink-0 text-green-400" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{document.title}</h3>
        <span className={mark.tag}>Document</span>
      </div>
      <div className={`relative min-w-0 ${open || !longer ? "" : "max-h-48 overflow-hidden"}`}>
        <Markdown source={shown} onOpenLink={onOpenLink} />
        {!open && longer && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-surface-2 to-transparent" aria-hidden="true" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {longer && (
          <button type="button" onClick={() => setOpen((shownAll) => !shownAll)} aria-expanded={open} className={button.compact}>
            <Icon name="chevron" className={`h-3 w-3 transition-transform duration-140 ease-ui ${open ? "rotate-180" : ""}`} />
            {open ? "Show less" : "Open"}
          </button>
        )}
        <button type="button" onClick={() => void copy()} className={button.compact}>
          <Icon name={copied ? "check" : "copy"} />
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className={button.compact}>
          <Icon name="down" />
          {saving ? "Saving…" : "Save as .md"}
        </button>
      </div>
      {note !== null && (
        <p role="status" className={note.kind === "saved" ? `flex items-center gap-1.5 ${text.detail} text-status-ok` : field.error}>
          <Icon name={note.kind === "saved" ? "check" : "cross"} className="h-3.5 w-3.5 shrink-0" />
          <span>{note.kind === "saved" ? `Saved as ${note.name}` : note.reason}</span>
        </p>
      )}
    </section>
  );
}
