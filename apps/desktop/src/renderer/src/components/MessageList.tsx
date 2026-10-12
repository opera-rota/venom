import type { Message } from "@venom/contracts";
import { useEffect, useRef } from "react";
import { surface, text } from "../ui.ts";
import { LogoMark } from "./Header.tsx";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function MessageItem({ message }: { readonly message: Message }) {
  const mine = message.speaker === "user";

  return (
    <article className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
      <div className={`flex items-baseline gap-2 ${text.detail}`}>
        <span className="text-ink-muted">{mine ? "You" : "VENOM"}</span>
        <time className="tabular text-ink-faint" dateTime={message.created_at}>
          {timeFormat.format(new Date(message.created_at))}
        </time>
      </div>
      <p className={`max-w-[85%] px-3.5 py-2.5 whitespace-pre-wrap break-words text-ink ${mine ? surface.bubble : surface.card}`}>
        {message.text}
      </p>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <LogoMark size={56} />
      <h2 className={text.display}>Talk to VENOM</h2>
      <p className={`${text.support} max-w-[46ch]`}>
        Every message travels to the gateway, is saved, and comes back here. Close the app and open it again: your messages stay.
      </p>
    </div>
  );
}

export function MessageList({ messages }: { readonly messages: readonly Message[] }) {
  const end = useRef<HTMLDivElement>(null);
  const latest = messages.at(-1)?.id;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [latest]);

  if (messages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ol className="mx-auto flex max-w-[72ch] flex-col gap-5 px-5 py-6" aria-label="Conversation">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageItem message={message} />
          </li>
        ))}
      </ol>
      <div ref={end} />
    </div>
  );
}
