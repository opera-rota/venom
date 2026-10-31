import type { Account, Device } from "@venom/contracts";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { VenomBridge } from "../../../shared/bridge.ts";
import { createConversation, type Scheduler } from "../conversation-store.ts";
import { isAnswering } from "../conversation.ts";
import { useDevices } from "../use-devices.ts";
import { useMemory } from "../use-memory.ts";
import { usePower } from "../use-power.ts";
import { taskInView } from "../tasks-state.ts";
import { useTasks } from "../use-tasks.ts";
import { Composer } from "./Composer.tsx";
import { ConfirmationGate } from "./ConfirmationGate.tsx";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { Header, type SidePanel } from "./Header.tsx";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { MessageList } from "./MessageList.tsx";
import { engineName, PowerPanel } from "./PowerPanel.tsx";
import { SafetyPanel } from "./SafetyPanel.tsx";
import { TaskStrip } from "./TaskStrip.tsx";

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
  const power = usePower(bridge, connection);
  const memory = useMemory(bridge, connection);
  const tasks = useTasks(bridge, connection);
  const inView = taskInView(tasks.state);
  const [panel, setPanel] = useState<SidePanel | null>(null);
  const openLink = useCallback((url: string) => void bridge.openLink(url), [bridge]);

  useEffect(() => conversation.connect(), [conversation]);

  return (
    <div className="flex h-full">
      <main className="flex min-w-0 flex-1 flex-col">
        <Header
          connection={connection}
          accountName={account.name}
          power={power.power}
          engineName={power.power === null ? null : engineName(power.engines, power.power)}
          panel={panel}
          onTogglePanel={(next) => setPanel((open) => (open === next ? null : next))}
          halt={tasks.halt}
          onStop={tasks.stop}
        />
        {inView !== null && <TaskStrip task={inView} deviceId={device.id} devices={devices.devices} onDismiss={tasks.dismiss} />}
        <MessageList store={store} devices={devices.devices} deviceId={device.id} onOpenLink={openLink} />
        <Composer connection={connection} answering={answering} notice={notice} onSend={send} onDismiss={dismiss} />
      </main>
      {panel === "devices" && <DevicesPanel state={devices} onClose={() => setPanel(null)} />}
      {panel === "power" && <PowerPanel state={power} onClose={() => setPanel(null)} />}
      {panel === "memory" && <MemoryPanel state={memory} onClose={() => setPanel(null)} />}
      {panel === "safety" && <SafetyPanel handle={tasks} onClose={() => setPanel(null)} />}
      <ConfirmationGate
        queue={tasks.state.queue}
        closed={tasks.state.closed}
        deviceId={device.id}
        sending={tasks.sending}
        onAnswer={(request, decision) => void tasks.answer(request, decision)}
        onSeen={tasks.seen}
      />
    </div>
  );
}
