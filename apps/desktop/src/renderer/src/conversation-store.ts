import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";
import {
  heldRequests,
  initialConversation,
  isLiveEvent,
  reduceConversation,
  type Answer,
  type ConversationAction,
  type ConversationState,
  type LiveEvent,
} from "./conversation.ts";

export const gapWaitMs = 3000;

export interface ConversationStore extends ConversationState {
  readonly connection: ConnectionState;
  send(text: string): Promise<boolean>;
  retry(answer: Answer): Promise<boolean>;
  dismiss(): void;
}

export interface ConversationHandle {
  readonly store: StoreApi<ConversationStore>;
  connect(): () => void;
}

export interface Scheduler {
  frame(run: () => void): void;
  later(run: () => void, ms: number): () => void;
}

export function createConversation(bridge: VenomBridge, scheduler: Scheduler): ConversationHandle {
  const store = createStore<ConversationStore>()((set, get) => {
    const dispatch = (action: ConversationAction) => set((state) => reduceConversation(state, action));
    return {
      ...initialConversation,
      connection: "connecting",
      async send(text) {
        const result = await bridge.send(text);
        if (!result.ok) {
          dispatch({ type: "notice", reason: result.reason });
        }
        return result.ok;
      },
      async retry(answer) {
        const result = await bridge.retry(answer.origin);
        if (result.ok) {
          dispatch({ type: "retrying", from: answer.requestId, to: result.requestId });
        } else if (get().answers.has(answer.requestId)) {
          dispatch({ type: "notice", reason: result.reason });
        }
        return result.ok;
      },
      dismiss() {
        dispatch({ type: "dismiss" });
      },
    };
  });

  const dispatch = (action: ConversationAction) => store.setState((state) => reduceConversation(state, action));

  function connect(): () => void {
    let active = true;
    let queued: LiveEvent[] = [];
    let flushing = false;
    const gaps = new Map<string, () => void>();

    const reload = () => {
      bridge.history().then(
        (messages) => {
          if (active) {
            dispatch({ type: "history", messages });
          }
        },
        () => {},
      );
    };

    const watchGaps = () => {
      const held = new Set(heldRequests(store.getState()));
      for (const [requestId, cancel] of gaps) {
        if (!held.has(requestId)) {
          cancel();
          gaps.delete(requestId);
        }
      }
      for (const requestId of held) {
        if (!gaps.has(requestId)) {
          gaps.set(
            requestId,
            scheduler.later(() => {
              gaps.delete(requestId);
              if (active) {
                dispatch({ type: "gap", requestId });
                reload();
              }
            }, gapWaitMs),
          );
        }
      }
    };

    const flush = () => {
      flushing = false;
      if (!active || queued.length === 0) {
        return;
      }
      const events = queued;
      queued = [];
      dispatch({ type: "events", events });
      watchGaps();
    };

    const follow = (connection: ConnectionState) => {
      if (!active) {
        return;
      }
      store.setState({ connection });
      if (connection === "online") {
        reload();
      }
    };

    const stopEvents = bridge.onEvent((event) => {
      if (event.type === "forgotten") {
        dispatch({ type: "forgotten", messageIds: event.message_ids });
        return;
      }
      if (!isLiveEvent(event)) {
        return;
      }
      queued.push(event);
      if (!flushing) {
        flushing = true;
        scheduler.frame(flush);
      }
    });
    const stopConnection = bridge.onConnection(follow);
    void bridge.connection().then(follow);

    return () => {
      active = false;
      stopEvents();
      stopConnection();
      for (const cancel of gaps.values()) {
        cancel();
      }
      gaps.clear();
    };
  }

  return { store, connect };
}
