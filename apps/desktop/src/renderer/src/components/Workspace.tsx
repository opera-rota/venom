import type { Account, Device } from "@venom/contracts";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { VenomBridge } from "../../../shared/bridge.ts";
import { createConversation, type Scheduler } from "../conversation-store.ts";
import { isAnswering } from "../conversation.ts";
import { useDevices } from "../use-devices.ts";
import { Composer } from "./Composer.tsx";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { Header } from "./Header.tsx";
import { MessageList } from "./MessageList.tsx";

const screenScheduler: Scheduler = {
  frame: (run) => {
    requestAnimationFrame(() => run());
  },
  later: (run, ms) => {
    const timer = window.setTimeout(run, ms);
    return () => window.clearTimeout(timer);
  },
};

export interface WorkspaceProps {
  readonly bridge: VenomBridge;
  readonly account: Account;
  readonly device: Device;
}

export function Workspace({ bridge, account, device }: WorkspaceProps) {
  const [conversation] = useState(() => createConversation(bridge, screenScheduler));
  const { store } = conversation;
  const connection = useStore(store, (state) => state.connection);
  const notice = useStore(store, (state) => state.notice);
  const answering = useStore(store, isAnswering);
  const send = useStore(store, (state) => state.send);
  const dismiss = useStore(store, (state) => state.dismiss);
  const devices = useDevices(bridge, device.id, connection);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const openLink = useCallback((url: string) => void bridge.openLink(url), [bridge]);

  useEffect(() => conversation.connect(), [conversation]);

  return (
    <div className="flex h-full">
      <main className="flex min-w-0 flex-1 flex-col">
        <Header
          connection={connection}
          accountName={account.name}
          devicesOpen={devicesOpen}
          onToggleDevices={() => setDevicesOpen((open) => !open)}
        />
        <MessageList store={store} onOpenLink={openLink} />
        <Composer connection={connection} answering={answering} notice={notice} onSend={send} onDismiss={dismiss} />
      </main>
      {devicesOpen && <DevicesPanel state={devices} onClose={() => setDevicesOpen(false)} />}
    </div>
  );
}
