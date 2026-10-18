import type { GatewayEvent, Message } from "@venom/contracts";

export interface ConversationState {
  readonly messages: readonly Message[];
  readonly pending: ReadonlySet<string>;
  readonly failure: string | null;
}

export type ConversationAction =
  | { readonly type: "history"; readonly messages: readonly Message[] }
  | { readonly type: "event"; readonly event: GatewayEvent }
  | { readonly type: "failure"; readonly reason: string }
  | { readonly type: "dismiss" };

export const initialConversation: ConversationState = {
  messages: [],
  pending: new Set(),
  failure: null,
};

function byTime(left: Message, right: Message): number {
  return left.created_at === right.created_at ? left.id.localeCompare(right.id) : left.created_at.localeCompare(right.created_at);
}

export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): readonly Message[] {
  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  return fresh.length === 0 ? current : [...current, ...fresh].sort(byTime);
}

function withPending(pending: ReadonlySet<string>, requestId: string, active: boolean): ReadonlySet<string> {
  const next = new Set(pending);
  if (active) {
    next.add(requestId);
  } else {
    next.delete(requestId);
  }
  return next;
}

function applyEvent(state: ConversationState, event: GatewayEvent): ConversationState {
  if (event.type === "message") {
    return { ...state, messages: mergeMessages(state.messages, [event.message]) };
  }
  if (event.type === "devices") {
    return state;
  }
  switch (event.state) {
    case "accepted":
      return { ...state, pending: withPending(state.pending, event.request_id, true) };
    case "completed":
      return { ...state, pending: withPending(state.pending, event.request_id, false) };
    case "failed":
      return {
        ...state,
        pending: withPending(state.pending, event.request_id, false),
        failure: event.detail ?? "VENOM could not finish this request.",
      };
  }
}

export function reduceConversation(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case "history":
      return { ...state, messages: mergeMessages(state.messages, action.messages) };
    case "event":
      return applyEvent(state, action.event);
    case "failure":
      return { ...state, failure: action.reason };
    case "dismiss":
      return { ...state, failure: null };
  }
}
