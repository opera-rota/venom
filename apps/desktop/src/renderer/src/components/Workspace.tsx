import type { Account, Device } from "@venom/contracts";
import { useState } from "react";
import type { VenomBridge } from "../../../shared/bridge.ts";
import { useConversation } from "../use-conversation.ts";
import { useDevices } from "../use-devices.ts";
import { Composer } from "./Composer.tsx";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { Header } from "./Header.tsx";
import { MessageList } from "./MessageList.tsx";

export interface WorkspaceProps {
  readonly bridge: VenomBridge;
  readonly account: Account;
  readonly device: Device;
}

export function Workspace({ bridge, account, device }: WorkspaceProps) {
  const conversation = useConversation(bridge);
  const devices = useDevices(bridge, device.id, conversation.connection);
  const [devicesOpen, setDevicesOpen] = useState(false);

  return (
    <div className="flex h-full">
      <main className="flex min-w-0 flex-1 flex-col">
        <Header
          connection={conversation.connection}
          accountName={account.name}
          devicesOpen={devicesOpen}
          onToggleDevices={() => setDevicesOpen((open) => !open)}
        />
        <MessageList messages={conversation.messages} />
        <Composer
          connection={conversation.connection}
          saving={conversation.pending.size > 0}
          failure={conversation.failure}
          onSend={conversation.send}
          onDismiss={conversation.dismiss}
        />
      </main>
      {devicesOpen && <DevicesPanel state={devices} onClose={() => setDevicesOpen(false)} />}
    </div>
  );
}
