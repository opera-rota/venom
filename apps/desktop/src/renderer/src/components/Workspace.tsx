import type { Account, Device } from "@venom/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { VenomBridge } from "../../../shared/bridge.ts";
import { createConversation, type Scheduler } from "../conversation-store.ts";
import { isAnswering } from "../conversation.ts";
import { useDevices } from "../use-devices.ts";
import { useMemory } from "../use-memory.ts";
import { usePower } from "../use-power.ts";
import { liveOutput, moveOf, movesOf, taskCount, taskInView } from "../tasks-state.ts";
import { controlKey, useTasks } from "../use-tasks.ts";
import { Composer } from "./Composer.tsx";
import { ConfirmationGate } from "./ConfirmationGate.tsx";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { Header, type SidePanel } from "./Header.tsx";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { MessageList, type Plans } from "./MessageList.tsx";
import { engineName, PowerPanel } from "./PowerPanel.tsx";
import { SafetyPanel } from "./SafetyPanel.tsx";
import { TasksPanel } from "./TasksPanel.tsx";
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
  const { control, controlling, state, sending, answer, answerMove, loadMoves, stopTask } = tasks;
  const messages = useStore(store, (current) => current.messages);
  const plans = useMemo<Plans>(
    () => ({
      tasks: state.tasks,
      deviceId: device.id,
      devices: devices.devices,
      open: state.queue,
      sending,
      discarding: (taskId) => controlling.has(controlKey(taskId, "discard")),
      discard: (taskId) => void control(taskId, { kind: "discard" }),
      starting: (taskId) => controlling.has(controlKey(taskId, "run")),
      run: (taskId) => void control(taskId, { kind: "run" }),
      output: (stepId) => liveOutput(state, stepId),
      answer: (request, decision) => void answer(request, decision),
      moves: (taskId) => movesOf(state, taskId),
      move: (taskId, moveId) => moveOf(state, taskId, moveId),
      loaded: (taskId) => state.loaded.has(taskId),
      picture: (taskId) => state.pictures.get(taskId) ?? null,
      stopping: (taskId) => controlling.has(controlKey(taskId, "stop")),
      stop: (taskId) => void stopTask(taskId),
      loadMoves,
      answerMove: (taskId, moveId, decision) => void answerMove(taskId, moveId, decision),
    }),
    [state, device.id, devices.devices, controlling, control, sending, answer, answerMove, loadMoves, stopTask],
  );
  const inChat = useMemo(() => new Set(messages.filter((message) => message.kind === "plan" && message.task_id !== null).map((message) => message.task_id)), [messages]);
  const gateQueue = useMemo(() => state.queue.filter((request) => !inChat.has(request.task_id)), [state.queue, inChat]);
  const gateClosed = useMemo(() => state.closed.filter((entry) => !inChat.has(entry.request.task_id)), [state.closed, inChat]);

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
          taskCount={taskCount(tasks.state)}
        />
        {inView !== null && panel !== "tasks" && (
          <TaskStrip
            task={inView}
            deviceId={device.id}
            devices={devices.devices}
            latest={movesOf(state, inView.id).at(-1) ?? null}
            onDismiss={tasks.dismiss}
            onOpenTasks={() => setPanel("tasks")}
          />
        )}
        <MessageList store={store} devices={devices.devices} deviceId={device.id} plans={plans} onOpenLink={openLink} />
        <Composer connection={connection} answering={answering} notice={notice} onSend={send} onDismiss={dismiss} />
      </main>
      {panel === "tasks" && <TasksPanel handle={tasks} deviceId={device.id} devices={devices.devices} onClose={() => setPanel(null)} />}
      {panel === "devices" && <DevicesPanel state={devices} onClose={() => setPanel(null)} />}
      {panel === "power" && <PowerPanel state={power} onClose={() => setPanel(null)} />}
      {panel === "memory" && <MemoryPanel state={memory} onClose={() => setPanel(null)} />}
      {panel === "safety" && <SafetyPanel handle={tasks} onClose={() => setPanel(null)} />}
      <ConfirmationGate
        queue={gateQueue}
        closed={gateClosed}
        deviceId={device.id}
        sending={tasks.sending}
        onAnswer={(request, decision) => void tasks.answer(request, decision)}
        onSeen={tasks.seen}
      />
    </div>
  );
}
