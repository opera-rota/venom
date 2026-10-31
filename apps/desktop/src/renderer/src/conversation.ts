import type { GatewayEvent, Message } from "@venom/contracts";

export type LiveEvent = Exclude<GatewayEvent, { readonly type: "devices" | "power" | "memory" | "forgotten" }>;

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
  | { readonly type: "history"; readonly messages: readonly Message[] }
  | { readonly type: "events"; readonly events: readonly LiveEvent[] }
  | { readonly type: "gap"; readonly requestId: string }
  | { readonly type: "retrying"; readonly from: string; readonly to: string }
  | { readonly type: "forgotten"; readonly messageIds: readonly string[] }
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

function byTime(left: Message, right: Message): number {
  return left.created_at === right.created_at ? left.id.localeCompare(right.id) : left.created_at.localeCompare(right.created_at);
}

export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): readonly Message[] {
  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  return fresh.length === 0 ? current : [...current, ...fresh].sort(byTime);
}

export function isLiveEvent(event: GatewayEvent): event is LiveEvent {
  return event.type === "message" || event.type === "answer" || event.type === "request";
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
          return { ...state, answers: withAnswer(state.answers, answerFor(state, requestId)) };
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

function remember(finished: ReadonlySet<string>, requestId: string): ReadonlySet<string> {
  const next = [...finished, requestId];
  return new Set(next.slice(-rememberedRequests));
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

function closeGap(state: ConversationState, requestId: string): ConversationState {
  const ordering = state.ordering.get(requestId);
  if (ordering === undefined || ordering.held.length === 0) {
    return state;
  }
  const current = ordering.held.reduce(apply, state);
  const last = ordering.held.at(-1)?.sequence ?? ordering.next;
  return settle(current, requestId, { next: last + 1, held: [] });
}

function retrying(state: ConversationState, from: string, to: string): ConversationState {
  const previous = state.answers.get(from);
  if (previous === undefined) {
    return state;
  }
  const answers = new Map(state.answers);
  answers.delete(from);
  const ordering = new Map(state.ordering);
  ordering.delete(from);
  const released = { ...state, answers, ordering, finished: remember(state.finished, from) };
  if (state.finished.has(to)) {
    return released;
  }
  const replacement = state.answers.get(to);
  answers.set(to, {
    requestId: to,
    origin: previous.origin,
    askedId: previous.askedId,
    text: replacement?.text ?? "",
    failure: replacement?.failure ?? null,
  });
  return released;
}

function fromHistory(state: ConversationState, messages: readonly Message[]): ConversationState {
  const known = new Set(messages.map((message) => message.id));
  const answers = new Map(
    [...state.answers].filter(([, answer]) => answer.failure !== null && answer.askedId !== null && known.has(answer.askedId)),
  );
  return { ...state, messages: [...messages].sort(byTime), answers, ordering: new Map() };
}

function forget(state: ConversationState, messageIds: readonly string[]): ConversationState {
  const removed = new Set(messageIds);
  if (!state.messages.some((message) => removed.has(message.id))) {
    return state;
  }
  const answers = new Map([...state.answers].filter(([, answer]) => answer.askedId === null || !removed.has(answer.askedId)));
  return { ...state, messages: state.messages.filter((message) => !removed.has(message.id)), answers };
}

export function reduceConversation(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "history":
      return fromHistory(state, action.messages);
    case "events":
      return action.events.reduce(receive, state);
    case "gap":
      return closeGap(state, action.requestId);
    case "retrying":
      return retrying(state, action.from, action.to);
    case "forgotten":
      return forget(state, action.messageIds);
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
