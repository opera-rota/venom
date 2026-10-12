import { Composer } from "./components/Composer.tsx";
import { Header } from "./components/Header.tsx";
import { MessageList } from "./components/MessageList.tsx";
import { useConversation } from "./use-conversation.ts";

export function App() {
  const conversation = useConversation(window.venom);

  return (
    <main className="flex h-full flex-col">
      <Header connection={conversation.connection} />
      <MessageList messages={conversation.messages} />
      <Composer
        connection={conversation.connection}
        saving={conversation.pending.size > 0}
        failure={conversation.failure}
        onSend={conversation.send}
        onDismiss={conversation.dismiss}
      />
    </main>
  );
}
