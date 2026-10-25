import type { Message } from "@venom/contracts";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { ConversationStore } from "../conversation-store.ts";
import { arrange, type Answer } from "../conversation.ts";
import { button, surface, text } from "../ui.ts";
import { LogoMark } from "./Header.tsx";
import { Icon } from "./Icon.tsx";
import { Markdown } from "./Markdown.tsx";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const caret = "▍";
const nearBottom = 96;

function Byline({ mine, time }: { readonly mine: boolean; readonly time: string | null }) {
  return (
    <div className={`flex items-baseline gap-2 ${text.detail}`}>
      <span className="text-ink-muted">{mine ? "You" : "VENOM"}</span>
      {time !== null && (
        <time className="tabular text-ink-faint" dateTime={time}>
          {timeFormat.format(new Date(time))}
        </time>
      )}
    </div>
  );
}

const MessageItem = memo(function MessageItem({ message, onOpenLink }: { readonly message: Message; readonly onOpenLink: (url: string) => void }) {
  const mine = message.speaker === "user";
  return (
    <article className={`flex flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
      <Byline mine={mine} time={message.created_at} />
      {mine ? (
        <p className={`max-w-[85%] px-3.5 py-2.5 whitespace-pre-wrap break-words text-ink ${surface.bubble}`}>{message.text}</p>
      ) : (
        <div className={`max-w-[92%] px-4 py-3 ${surface.card}`}>
          <Markdown source={message.text} onOpenLink={onOpenLink} />
        </div>
      )}
    </article>
  );
});

interface AnswerItemProps {
  readonly answer: Answer;
  readonly onRetry: (answer: Answer) => Promise<boolean>;
  readonly onOpenLink: (url: string) => void;
}

const AnswerItem = memo(function AnswerItem({ answer, onRetry, onOpenLink }: AnswerItemProps) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    if (!(await onRetry(answer))) {
      setRetrying(false);
    }
  }

  if (answer.failure !== null) {
    return (
      <article className="flex flex-col items-start gap-1.5">
        <Byline mine={false} time={null} />
        <div role="alert" className={`flex max-w-[92%] flex-col gap-2.5 border-l-4 border-l-status-fail px-4 py-3 ${surface.card}`}>
          <p className="flex items-start gap-2 text-ink">
            <Icon name="warning" className="mt-1 h-3.5 w-3.5 shrink-0 text-status-fail" />
            <span>{answer.failure}</span>
          </p>
          <p className={text.support}>Your message is saved. VENOM can try to answer it again.</p>
          <button type="button" onClick={() => void retry()} disabled={retrying} className={`${button.secondary} self-start px-3.5 py-1.5 text-[13px]`}>
            <Icon name={retrying ? "hourglass" : "retry"} />
            <span>{retrying ? "Trying again" : "Try again"}</span>
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="flex flex-col items-start gap-1.5" aria-busy="true">
      <Byline mine={false} time={null} />
      <div className={`max-w-[92%] px-4 py-3 ${surface.card}`}>
        {answer.text.length === 0 ? (
          <p className={`flex items-center gap-2 ${text.support}`}>
            <Icon name="hourglass" className="h-3.5 w-3.5 text-status-wait" />
            <span>Thinking</span>
          </p>
        ) : (
          <Markdown source={answer.text + caret} onOpenLink={onOpenLink} />
        )}
      </div>
    </article>
  );
});

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <LogoMark size={56} />
      <h2 className={text.display}>Talk to VENOM</h2>
      <p className={`${text.support} max-w-[46ch]`}>Ask VENOM anything, or tell it what to do.</p>
    </div>
  );
}

export interface MessageListProps {
  readonly store: StoreApi<ConversationStore>;
  readonly onOpenLink: (url: string) => void;
}

export function MessageList({ store, onOpenLink }: MessageListProps) {
  const messages = useStore(store, (state) => state.messages);
  const answers = useStore(store, (state) => state.answers);
  const retry = useStore(store, (state) => state.retry);
  const { placed, loose } = useMemo(() => arrange({ messages, answers }), [messages, answers]);
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const lastSpoken = messages.findLast((message) => message.speaker === "venom");

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    if (pinned) {
      element.scrollTop = element.scrollHeight;
    } else {
      setUnseen(true);
    }
  }, [messages, answers, pinned]);

  useEffect(() => {
    if (pinned) {
      setUnseen(false);
    }
  }, [pinned]);

  function onScroll() {
    const element = scroller.current;
    if (element !== null) {
      setPinned(element.scrollHeight - element.scrollTop - element.clientHeight < nearBottom);
    }
  }

  function jumpToLatest() {
    const element = scroller.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
    setPinned(true);
  }

  if (messages.length === 0 && loose.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <ol className="mx-auto flex max-w-[72ch] flex-col gap-5 px-5 py-6" aria-label="Conversation">
          {placed.map(({ message, answers: pending }) => (
            <li key={message.id} className="flex flex-col gap-5">
              <MessageItem message={message} onOpenLink={onOpenLink} />
              {pending.map((answer) => (
                <AnswerItem key={answer.requestId} answer={answer} onRetry={retry} onOpenLink={onOpenLink} />
              ))}
            </li>
          ))}
          {loose.map((answer) => (
            <li key={answer.requestId}>
              <AnswerItem answer={answer} onRetry={retry} onOpenLink={onOpenLink} />
            </li>
          ))}
        </ol>
      </div>
      {unseen && !pinned && (
        <button
          type="button"
          onClick={jumpToLatest}
          className={`${button.secondary} absolute bottom-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 text-[13px] shadow-overlay`}
        >
          <Icon name="down" />
          <span>New reply</span>
        </button>
      )}
      <div className="sr-only" aria-live="polite">
        {lastSpoken?.text ?? ""}
      </div>
    </div>
  );
}
