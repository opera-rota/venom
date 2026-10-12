import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ConnectionState } from "../../../shared/bridge.ts";
import { button, field, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const limit = 4000;

export interface ComposerProps {
  readonly connection: ConnectionState;
  readonly saving: boolean;
  readonly failure: string | null;
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onDismiss: () => void;
}

export function Composer({ connection, saving, failure, onSend, onDismiss }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const online = connection === "online";
  const trimmed = draft.trim();
  const canSend = online && !sending && trimmed.length > 0 && draft.length <= limit;

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

  const hint = online ? "Enter to send, Shift+Enter for a new line" : "Messages can be sent once the gateway is reachable";

  return (
    <div className="border-t border-line-subtle px-5 pt-4 pb-5">
      <form onSubmit={(event) => void submit(event)} className={`mx-auto flex max-w-[72ch] flex-col gap-2 p-3 ${surface.card}`}>
        <div className="flex items-end gap-3">
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <textarea
            id="message"
            autoFocus
            rows={1}
            maxLength={limit}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message VENOM"
            className={`${field.input} max-h-40`}
          />
          <button type="submit" disabled={!canSend} className={button.primary}>
            <span>Send</span>
            <Icon name="send" />
          </button>
        </div>
        <div className={`flex min-h-5 items-center justify-between gap-3 ${text.detail}`}>
          {failure === null ? (
            <span className="text-ink-faint">{saving ? "Saving" : hint}</span>
          ) : (
            <span role="alert" className="flex items-center gap-1.5 text-red-400">
              <Icon name="cross" />
              <span>{failure}</span>
              <button type="button" onClick={onDismiss} className={`${button.ghost} px-1.5 py-0 text-[11.5px]`}>
                Dismiss
              </button>
            </span>
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
