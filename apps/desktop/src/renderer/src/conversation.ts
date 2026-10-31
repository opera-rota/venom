import type { Device, ForgottenEvent, GatewayEvent, Message, MessageHistory, PendingAnswer, QuestionRef } from "@venom/contracts";

export type LiveEvent = Extract<GatewayEvent, { readonly type: "message" | "answer" | "request" }>;

export type ConversationEvent = LiveEvent | ForgottenEvent;

export interface Answer {
  readonly requestId: string;
  readonly origin: string;
  readonly askedId: string | null;
  readonly text: string;
  readonly failure: string | null;
}

interface Ordering {
  readonly next: number;
  readonly held: readonly LiveEvent[];
}

export interface ConversationState {
  readonly messages: readonly Message[];
  readonly answers: ReadonlyMap<string, Answer>;
  readonly ordering: ReadonlyMap<string, Ordering>;
  readonly finished: ReadonlySet<string>;
  readonly notice: string | null;
}

export type ConversationAction =
  | { readonly type: "history"; readonly history: MessageHistory; readonly replay: readonly ConversationEvent[] }
  | { readonly type: "events"; readonly events: readonly ConversationEvent[] }
  | { readonly type: "gap"; readonly requestId: string }
  | { readonly type: "notice"; readonly reason: string }
  | { readonly type: "dismiss" };

export const initialConversation: ConversationState = {
  messages: [],
  answers: new Map(),
  ordering: new Map(),
  finished: new Set(),
  notice: null,
};

const rememberedRequests = 200;

const unfinished = "VENOM could not finish this request.";

const conversationEvents: ReadonlySet<GatewayEvent["type"]> = new Set(["message", "answer", "request", "forgotten"]);

function byTime(left: Message, right: Message): number {
  return left.created_at === right.created_at ? left.id.localeCompare(right.id) : left.created_at.localeCompare(right.created_at);
}

export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): readonly Message[] {
  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  return fresh.length === 0 ? current : [...current, ...fresh].sort(byTime);
}

export function isConversationEvent(event: GatewayEvent): event is ConversationEvent {
  return conversationEvents.has(event.type);
}

function withAnswer(answers: ReadonlyMap<string, Answer>, answer: Answer): ReadonlyMap<string, Answer> {
  return new Map(answers).set(answer.requestId, answer);
}

function withoutAnswer(answers: ReadonlyMap<string, Answer>, requestId: string): ReadonlyMap<string, Answer> {
  if (!answers.has(requestId)) {
    return answers;
  }
  const next = new Map(answers);
  next.delete(requestId);
  return next;
}

function answerFor(state: ConversationState, requestId: string): Answer {
  return state.answers.get(requestId) ?? { requestId, origin: requestId, askedId: null, text: "", failure: null };
}

function remember(finished: ReadonlySet<string>, requestId: string): ReadonlySet<string> {
  const next = [...finished, requestId];
  return new Set(next.slice(-rememberedRequests));
}

function release(state: ConversationState, requestId: string): ConversationState {
  const ordering = new Map(state.ordering);
  ordering.delete(requestId);
  return { ...state, answers: withoutAnswer(state.answers, requestId), ordering, finished: remember(state.finished, requestId) };
}

function accept(state: ConversationState, requestId: string, question: QuestionRef): ConversationState {
  const superseded = [...state.answers.values()].filter((answer) => answer.requestId !== requestId && answer.askedId === question.message_id);
  const cleared = superseded.reduce((current, answer) => release(current, answer.requestId), state);
  const answer = answerFor(cleared, requestId);
  return { ...cleared, answers: withAnswer(cleared.answers, { ...answer, origin: question.request_id, askedId: question.message_id }) };
}

function apply(state: ConversationState, event: LiveEvent): ConversationState {
  const requestId = event.request_id;
  switch (event.type) {
    case "message": {
      const messages = mergeMessages(state.messages, [event.message]);
      if (event.message.speaker === "venom") {
        return { ...state, messages, answers: withoutAnswer(state.answers, requestId) };
      }
      return { ...state, messages, answers: withAnswer(state.answers, { ...answerFor(state, requestId), askedId: event.message.id }) };
    }
    case "answer": {
      const answer = answerFor(state, requestId);
      return { ...state, answers: withAnswer(state.answers, { ...answer, text: answer.text + event.delta, failure: null }) };
    }
    case "request":
      switch (event.state) {
        case "accepted":
          return event.question === null
            ? { ...state, answers: withAnswer(state.answers, answerFor(state, requestId)) }
            : accept(state, requestId, event.question);
        case "completed":
          return { ...state, answers: withoutAnswer(state.answers, requestId) };
        case "failed": {
          const answer = answerFor(state, requestId);
          const reason = event.detail ?? unfinished;
          if (answer.askedId === null) {
            return { ...state, answers: withoutAnswer(state.answers, requestId), notice: reason };
          }
          return { ...state, answers: withAnswer(state.answers, { ...answer, failure: reason }) };
        }
      }
  }
}

function settle(state: ConversationState, requestId: string, ordering: Ordering): ConversationState {
  if (state.answers.has(requestId) || ordering.held.length > 0) {
    return { ...state, ordering: new Map(state.ordering).set(requestId, ordering) };
  }
  const next = new Map(state.ordering);
  next.delete(requestId);
  return { ...state, ordering: next, finished: remember(state.finished, requestId) };
}

function receive(state: ConversationState, event: LiveEvent): ConversationState {
  const requestId = event.request_id;
  if (state.finished.has(requestId)) {
    return state;
  }
  const ordering = state.ordering.get(requestId) ?? { next: 0, held: [] };
  if (event.sequence < ordering.next || ordering.held.some((held) => held.sequence === event.sequence)) {
    return state;
  }
  if (event.sequence > ordering.next) {
    const held = [...ordering.held, event].sort((left, right) => left.sequence - right.sequence);
    return { ...state, ordering: new Map(state.ordering).set(requestId, { ...ordering, held }) };
  }

  let current = apply(state, event);
  let next = ordering.next + 1;
  let held = ordering.held;
  while (held[0]?.sequence === next) {
    current = apply(current, held[0]);
    held = held.slice(1);
    next += 1;
  }
  return settle(current, requestId, { next, held });
}

function forget(state: ConversationState, messageIds: readonly string[]): ConversationState {
  const removed = new Set(messageIds);
  if (!state.messages.some((message) => removed.has(message.id))) {
    return state;
  }
  const answers = new Map([...state.answers].filter(([, answer]) => answer.askedId === null || !removed.has(answer.askedId)));
  return { ...state, messages: state.messages.filter((message) => !removed.has(message.id)), answers };
}

function step(state: ConversationState, event: ConversationEvent): ConversationState {
  return event.type === "forgotten" ? forget(state, event.message_ids) : receive(state, event);
}

function closeGap(state: ConversationState, requestId: string): ConversationState {
  const ordering = state.ordering.get(requestId);
  if (ordering === undefined || ordering.held.length === 0) {
    return state;
  }
  const current = ordering.held.reduce(apply, state);
  const last = ordering.held.at(-1)?.sequence ?? ordering.next;
  return settle(current, requestId, { next: last + 1, held: [] });
}

function pendingAnswer({ request_id, question, text, failure }: PendingAnswer): Answer {
  return { requestId: request_id, origin: question.request_id, askedId: question.message_id, text, failure };
}

function fromHistory(state: ConversationState, history: MessageHistory, replay: readonly ConversationEvent[]): ConversationState {
  const pending = history.pending.filter((entry) => !state.finished.has(entry.request_id));
  const replaced: ConversationState = {
    ...state,
    messages: [...history.messages].sort(byTime),
    answers: new Map(pending.map((entry) => [entry.request_id, pendingAnswer(entry)])),
    ordering: new Map(pending.map((entry) => [entry.request_id, { next: entry.sequence + 1, held: [] }])),
  };
  return replay.reduce(step, replaced);
}

export function reduceConversation(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "history":
      return fromHistory(state, action.history, action.replay);
    case "events":
      return action.events.reduce(step, state);
    case "gap":
      return closeGap(state, action.requestId);
    case "notice":
      return { ...state, notice: action.reason };
    case "dismiss":
      return { ...state, notice: null };
  }
}

export function heldRequests(state: ConversationState): string[] {
  return [...state.ordering].filter(([, ordering]) => ordering.held.length > 0).map(([requestId]) => requestId);
}

export function isAnswering(state: ConversationState): boolean {
  return [...state.answers.values()].some((answer) => answer.failure === null);
}

export function sentFrom(message: Message, devices: readonly Device[], currentDeviceId: string): string | null {
  if (message.speaker !== "user" || message.device_id === currentDeviceId) {
    return null;
  }
  const device = devices.find((candidate) => candidate.id === message.device_id);
  return device === undefined ? "From another device" : `From ${device.name}`;
}

export interface Placed {
  readonly message: Message;
  readonly answers: readonly Answer[];
}

export interface Arrangement {
  readonly placed: readonly Placed[];
  readonly loose: readonly Answer[];
}

export function arrange(state: Pick<ConversationState, "messages" | "answers">): Arrangement {
  const known = new Set(state.messages.map((message) => message.id));
  const byAsked = new Map<string, Answer[]>();
  const loose: Answer[] = [];
  for (const answer of state.answers.values()) {
    if (answer.askedId !== null && known.has(answer.askedId)) {
      byAsked.set(answer.askedId, [...(byAsked.get(answer.askedId) ?? []), answer]);
    } else {
      loose.push(answer);
    }
  }
  return {
    placed: state.messages.map((message) => ({ message, answers: byAsked.get(message.id) ?? [] })),
    loose,
  };
}
