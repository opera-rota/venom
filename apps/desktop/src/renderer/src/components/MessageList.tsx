import type { ChatDocument, ConfirmDecision, ConfirmRequest, Device, Message, Task, TaskMove, Thumbnail } from "@venom/contracts";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { SaveResult } from "../../../shared/bridge.ts";
import type { ConversationStore } from "../conversation-store.ts";
import { arrange, sentFrom, type Answer } from "../conversation.ts";
import { moveAnswerWords } from "../move-words.ts";
import { button, mark, surface, text } from "../ui.ts";
import { DocumentCard } from "./DocumentCard.tsx";
import { Emblem } from "./Emblem.tsx";
import { Icon } from "./Icon.tsx";
import { JobCard } from "./JobCard.tsx";
import { Markdown } from "./Markdown.tsx";
import { PlanCard } from "./PlanCard.tsx";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const caret = "▍";
const nearBottom = 96;

interface BylineProps {
  readonly mine: boolean;
  readonly time: string | null;
  readonly from?: string | null;
}

function Byline({ mine, time, from = null }: BylineProps) {
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${mine ? "justify-end" : ""} ${text.detail}`}>
      {from !== null && <span className={`${mark.tag} max-w-full truncate`}>{from}</span>}
      <span className={mine ? "text-ink-muted" : "hud text-[9.5px] text-green-300/80"}>{mine ? "You" : "VENOM"}</span>
      {time !== null && (
        <time className="tabular whitespace-nowrap text-ink-faint" dateTime={time}>
          {timeFormat.format(new Date(time))}
        </time>
      )}
      {mine && <Icon name="check" className="h-3 w-3 text-green-400" />}
    </div>
  );
}

function YouMark() {
  return (
    <span className="mt-6 hidden h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong bg-linear-to-br from-surface-3 to-surface-1 text-ink-muted sm:grid" aria-hidden="true">
      <Icon name="user" className="h-4 w-4" />
    </span>
  );
}

function VenomMark() {
  return (
    <span className="mt-6 hidden shrink-0 sm:block">
      <Emblem size={38} alive={false} />
    </span>
  );
}

export interface Plans {
  readonly tasks: ReadonlyMap<string, Task>;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly open: readonly ConfirmRequest[];
  readonly sending: ReadonlySet<string>;
  discarding(taskId: string): boolean;
  discard(taskId: string): void;
  starting(taskId: string): boolean;
  run(taskId: string): void;
  output(stepId: string): string | null;
  answer(request: ConfirmRequest, decision: ConfirmDecision): void;
  moves(taskId: string): readonly TaskMove[];
  move(taskId: string, moveId: string): TaskMove | null;
  loaded(taskId: string): boolean;
  picture(taskId: string): Thumbnail | null;
  stopping(taskId: string): boolean;
  stop(taskId: string): void;
  loadMoves(taskId: string): void;
  answerMove(taskId: string, moveId: string, decision: ConfirmDecision): void;
  carryOn(taskId: string): void;
}

interface MessageItemProps {
  readonly message: Message;
  readonly from: string | null;
  readonly plans: Plans;
  readonly task: Task | undefined;
  readonly job: boolean;
  readonly onOpenLink: (url: string) => void;
  readonly onSaveDocument: (document: ChatDocument) => Promise<SaveResult>;
}

const reportEdge: Partial<Record<Task["status"], string>> = {
  completed: "border-l-4 border-l-status-ok",
  failed: "border-l-4 border-l-status-fail",
  stopped: "border-l-4 border-l-status-fail",
  cancelled: "border-l-4 border-l-status-idle",
};

function answeredWords(task: Task | undefined, stepId: string | null): string {
  const step = task?.plan.find((candidate) => candidate.id === stepId);
  if (step === undefined || task === undefined) {
    return "This question is closed.";
  }
  if (step.status === "running" || step.status === "done" || step.status === "failed") {
    return "You said yes.";
  }
  if (task.status === "cancelled" && step.status === "stopped") {
    return "You said no.";
  }
  if (step.status === "stopped") {
    return "You said yes, then the task was stopped.";
  }
  if (task.status === "stopped") {
    return "Closed, because the task was stopped.";
  }
  return "This question is closed.";
}

interface AnswerButtonsProps {
  readonly busy: boolean;
  readonly onAnswer: (decision: ConfirmDecision) => void;
}

function AnswerButtons({ busy, onAnswer }: AnswerButtonsProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Your answer">
      <button type="button" disabled={busy} onClick={() => onAnswer("approve")} className={button.gateApprove}>
        <Icon name="check" className="h-3.5 w-3.5 text-status-ok" />
        <span>{busy ? "Sending…" : "Yes, do it"}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => onAnswer("decline")} className={button.gateCancel}>
        <Icon name="cross" className="h-3.5 w-3.5" />
        <span>No</span>
      </button>
      <span className={`${text.detail} text-ink-faint`}>or type yes or no</span>
    </div>
  );
}

function MoveQuestion({ taskId, moveId, plans, task }: { readonly taskId: string; readonly moveId: string; readonly plans: Plans; readonly task: Task | undefined }) {
  const move = plans.move(taskId, moveId);
  if (move?.status === "asking" && task?.status === "awaiting_confirmation") {
    return <AnswerButtons busy={plans.sending.has(moveId)} onAnswer={(decision) => plans.answerMove(taskId, moveId, decision)} />;
  }
  return <p className={`mt-2 ${text.support}`}>{move === null && task?.status === "awaiting_confirmation" ? "Type yes or no to answer." : moveAnswerWords(move)}</p>;
}

function Question({ message, plans, task }: { readonly message: Message; readonly plans: Plans; readonly task: Task | undefined }) {
  if (message.move_id !== null && message.task_id !== null) {
    return <MoveQuestion taskId={message.task_id} moveId={message.move_id} plans={plans} task={task} />;
  }
  const request = plans.open.find((candidate) => candidate.step_id === message.step_id);
  if (request === undefined) {
    return <p className={`mt-2 ${text.support}`}>{answeredWords(task, message.step_id)}</p>;
  }
  return <AnswerButtons busy={plans.sending.has(request.step_id)} onAnswer={(decision) => plans.answer(request, decision)} />;
}

const MessageItem = memo(function MessageItem({ message, from, plans, task, job, onOpenLink, onSaveDocument }: MessageItemProps) {
  const mine = message.speaker === "user";
  const edge = message.kind === "question" ? "border-l-4 border-l-status-wait" : message.kind === "report" ? (reportEdge[task?.status ?? "completed"] ?? "") : "";
  return (
    <article className={`flex animate-rise gap-3 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && <VenomMark />}
      <div className={`flex min-w-0 flex-col gap-1.5 ${mine ? "max-w-[88%] items-end sm:max-w-[82%]" : "max-w-full flex-1 items-start sm:max-w-[88%]"}`}>
        <Byline mine={mine} time={message.created_at} from={from} />
        {mine ? (
          <p className={`px-4 py-3 text-[14.5px] whitespace-pre-wrap break-words text-ink ${surface.bubble}`}>{message.text}</p>
        ) : (
          <div className={`w-fit max-w-full px-4 py-3.5 text-[14.5px] ${surface.venom} ${edge}`}>
            <Markdown source={message.text} onOpenLink={onOpenLink} />
            {message.document !== null && <DocumentCard document={message.document} onOpenLink={onOpenLink} onSave={onSaveDocument} />}
            {message.kind === "plan" && (
              <PlanCard
                task={task}
                deviceId={plans.deviceId}
                devices={plans.devices}
                discarding={message.task_id !== null && plans.discarding(message.task_id)}
                starting={message.task_id !== null && plans.starting(message.task_id)}
                output={plans.output}
                onDiscard={plans.discard}
                onRun={plans.run}
              />
            )}
            {message.kind === "question" && <Question message={message} plans={plans} task={task} />}
            {job && message.task_id !== null && (
              <JobCard
                task={task}
                moves={plans.moves(message.task_id)}
                loaded={plans.loaded(message.task_id)}
                picture={plans.picture(message.task_id)}
                deviceId={plans.deviceId}
                devices={plans.devices}
                stopping={plans.stopping(message.task_id)}
                onLoad={plans.loadMoves}
                onStop={plans.stop}
                onContinue={plans.carryOn}
              />
            )}
          </div>
        )}
      </div>
      {mine && <YouMark />}
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
      <article className="flex gap-3">
        <VenomMark />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          <Byline mine={false} time={null} />
          <div role="alert" className={`flex max-w-[92%] flex-col gap-2.5 border-l-4 border-l-status-fail px-4 py-3 ${surface.venom}`}>
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
        </div>
      </article>
    );
  }

  return (
    <article className="flex gap-3" aria-busy="true">
      <span className="mt-6 hidden shrink-0 sm:block">
        <Emblem size={38} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <Byline mine={false} time={null} />
        <div className={`max-w-[92%] px-4 py-3.5 text-[14.5px] ${surface.venom}`}>
          {answer.text.length === 0 ? (
            <p className="flex items-center gap-2.5 text-[13px] text-green-300">
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-green-400 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-green-400 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-green-400" />
              </span>
              <span>Thinking</span>
            </p>
          ) : (
            <Markdown source={answer.text + caret} onOpenLink={onOpenLink} />
          )}
        </div>
      </div>
    </article>
  );
});

function Greeting({ name }: { readonly name: string }) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return (
    <section aria-label="Welcome" className="glass-glow relative flex animate-rise items-center gap-4 overflow-hidden rounded-panel px-5 py-5 sm:px-6">
      <div className="absolute -top-20 -left-10 h-48 w-48 rounded-full bg-green-500/20 blur-3xl" aria-hidden="true" />
      <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-green-400/35 bg-green-400/10 text-green-300 shadow-[0_0_26px_-6px_rgba(31,242,92,0.9)]">
        <Icon name="sparkle" className="h-7 w-7" />
      </span>
      <div className="relative flex min-w-0 flex-col">
        <h2 className="text-[24px] font-bold tracking-[-0.02em] text-ink sm:text-[28px]">
          Hello {first} <span aria-hidden="true">👋</span>
        </h2>
        <p className="text-[15px] text-ink-muted">What would you like to do today?</p>
      </div>
    </section>
  );
}

export interface MessageListProps {
  readonly name: string;
  readonly store: StoreApi<ConversationStore>;
  readonly devices: readonly Device[];
  readonly deviceId: string;
  readonly plans: Plans;
  readonly onOpenLink: (url: string) => void;
  readonly onSaveDocument: (document: ChatDocument) => Promise<SaveResult>;
}

export function MessageList({ name, store, devices, deviceId, plans, onOpenLink, onSaveDocument }: MessageListProps) {
  const messages = useStore(store, (state) => state.messages);
  const answers = useStore(store, (state) => state.answers);
  const retry = useStore(store, (state) => state.retry);
  const { placed, loose } = useMemo(() => arrange({ messages, answers }), [messages, answers]);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLOListElement>(null);
  const stuck = useRef(true);
  const [pinned, setPinned] = useState(true);
  const empty = messages.length === 0 && loose.length === 0;
  const [unseen, setUnseen] = useState(false);
  const lastSpoken = messages.findLast((message) => message.speaker === "venom");
  const jobs = useMemo(() => {
    const first = new Map<string, string>();
    for (const message of messages) {
      if (message.kind === "report" && message.task_id !== null && !first.has(message.task_id) && plans.tasks.get(message.task_id)?.kind === "goal") {
        first.set(message.task_id, message.id);
      }
    }
    return new Set(first.values());
  }, [messages, plans.tasks]);

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
  }, [messages, answers, plans, pinned]);

  useEffect(() => {
    stuck.current = pinned;
    if (pinned) {
      setUnseen(false);
    }
  }, [pinned]);

  useEffect(() => {
    const element = scroller.current;
    const list = content.current;
    if (empty || element === null || list === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (stuck.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [empty]);

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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-4 pt-5 sm:px-6">
          <Greeting name={name} />
        </div>
        {empty && <p className={`mx-auto max-w-[860px] px-6 pt-6 text-center ${text.support}`}>Ask VENOM anything, or tell it what to do on any of your devices.</p>}
        <ol ref={content} className="mx-auto flex max-w-[860px] flex-col gap-6 px-4 py-6 sm:px-6" aria-label="Conversation">
          {placed.map(({ message, answers: pending }) => (
            <li key={message.id} className="flex flex-col gap-5">
              <MessageItem
                message={message}
                from={sentFrom(message, devices, deviceId)}
                plans={plans}
                task={message.task_id === null ? undefined : plans.tasks.get(message.task_id)}
                job={jobs.has(message.id)}
                onOpenLink={onOpenLink}
                onSaveDocument={onSaveDocument}
              />
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
