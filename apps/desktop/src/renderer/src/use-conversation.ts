import { useCallback, useEffect, useReducer, useState } from "react";
import type { ConnectionState, VenomBridge } from "../../shared/bridge.ts";
import { initialConversation, reduceConversation, type ConversationState } from "./conversation.ts";

export interface Conversation extends ConversationState {
  readonly connection: ConnectionState;
  send(text: string): Promise<boolean>;
  dismiss(): void;
}

export function useConversation(bridge: VenomBridge): Conversation {
  const [state, dispatch] = useReducer(reduceConversation, initialConversation);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let active = true;

    const loadHistory = () => {
      bridge.history().then(
        (messages) => {
          if (active) {
            dispatch({ type: "history", messages });
          }
        },
        () => {},
      );
    };

    const follow = (next: ConnectionState) => {
      if (!active) {
        return;
      }
      setConnection(next);
      if (next === "online") {
        loadHistory();
      }
    };

    const stopEvents = bridge.onEvent((event) => dispatch({ type: "event", event }));
    const stopConnection = bridge.onConnection(follow);
    void bridge.connection().then(follow);

    return () => {
      active = false;
      stopEvents();
      stopConnection();
    };
  }, [bridge]);

  const send = useCallback(
    async (text: string) => {
      const result = await bridge.send(text);
      if (!result.ok) {
        dispatch({ type: "failure", reason: result.reason });
      }
      return result.ok;
    },
    [bridge],
  );

  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), []);

  return { ...state, connection, send, dismiss };
}
