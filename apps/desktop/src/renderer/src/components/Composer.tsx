import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ConnectionState } from "../../../shared/bridge.ts";
import { button, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const limit = 4000;

export interface Seed {
  readonly text: string;
  readonly at: number;
}

export interface ComposerProps {
  readonly connection: ConnectionState;
  readonly answering: boolean;
  readonly notice: string | null;
  readonly seed: Seed | null;
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onDismiss: () => void;
}

const soon = {
  voice: "Voice notes are coming soon, buddy. You will talk and I will listen.",
  files: "Sending files is coming soon, buddy. You will drop a file here and I will keep it.",
} as const;

export function Composer({ connection, answering, notice, seed, onSend, onDismiss }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const online = connection === "online";
  const trimmed = draft.trim();
  const canSend = online && !sending && trimmed.length > 0 && draft.length <= limit;

  useEffect(() => {
    if (seed === null) {
      return;
    }
    setDraft(seed.text);
    const element = box.current;
    if (element !== null) {
      element.focus();
      element.setSelectionRange(seed.text.length, seed.text.length);
    }
  }, [seed]);

  useEffect(() => {
    if (hint === null) {
      return;
    }
    const timer = window.setTimeout(() => setHint(null), 4500);
    return () => window.clearTimeout(timer);
  }, [hint]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) {
      return;
    }
    setSending(true);
    if (await onSend(trimmed)) {
      setDraft("");
    }
    setSending(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      void submit(event);
    }
  }

  const status = online ? (answering ? "VENOM is answering. You can keep writing." : "Enter to send · Shift+Enter for a new line") : "Messages can be sent once VENOM is reachable";

  return (
    <div className="relative px-4 pt-2 pb-4 sm:px-6 sm:pb-5">
      <form onSubmit={(event) => void submit(event)} className="mx-auto flex max-w-[860px] flex-col gap-2">
        <div className="flex items-end gap-3">
          <button type="button" onClick={() => setHint(soon.voice)} aria-label="Voice note, coming soon" title="Voice note" className={`${button.icon} h-14 w-14 border-green-400/30 text-green-300 shadow-[0_0_24px_-8px_rgba(31,242,92,0.8)]`}>
            <Icon name="wave" className="h-6 w-6" />
          </button>
          <div className="ring-live glass-glow flex min-w-0 flex-1 items-end gap-2 rounded-[28px] py-2 pr-2 pl-3 focus-within:shadow-[0_0_0_1px_rgba(77,255,124,0.6),0_0_44px_-6px_rgba(31,242,92,0.65)]">
            <button type="button" onClick={() => setHint(soon.files)} aria-label="Attach a file, coming soon" title="Attach a file" className="mb-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-white/5 hover:text-green-300">
              <Icon name="clip" className="h-[18px] w-[18px]" />
            </button>
            <label htmlFor="message" className="sr-only">
              Message
            </label>
            <textarea
              ref={box}
              id="message"
              autoFocus
              rows={1}
              maxLength={limit}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message VENOM…"
              className="field-sizing-content max-h-40 min-h-11 w-full resize-none bg-transparent py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-faint focus-visible:shadow-none"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-linear-to-b from-green-300 to-green-500 text-on-accent shadow-accent transition-[transform,filter,opacity] duration-200 ease-ui hover:brightness-110 active:scale-95 disabled:opacity-35 disabled:shadow-none"
            >
              <Icon name="send" className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className={`flex min-h-5 items-center justify-between gap-3 pl-[68px] ${text.detail}`}>
          {notice !== null ? (
            <span role="alert" className="flex items-center gap-1.5 text-red-400">
              <Icon name="cross" />
              <span>{notice}</span>
              <button type="button" onClick={onDismiss} className={`${button.ghost} px-1.5 py-0 text-[11.5px]`}>
                Dismiss
              </button>
            </span>
          ) : hint !== null ? (
            <span role="status" className="flex animate-rise items-center gap-1.5 text-green-300">
              <Icon name="sparkle" />
              <span>{hint}</span>
            </span>
          ) : (
            <span className="text-ink-faint">{status}</span>
          )}
          {draft.length > limit - 500 && (
            <span className="tabular text-ink-faint">
              {draft.length} / {limit}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
