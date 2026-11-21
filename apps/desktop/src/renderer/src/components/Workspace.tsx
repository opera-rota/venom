import type { Account, ChatDocument, Device, SkippableEffect, Task } from "@venom/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { VenomBridge } from "../../../shared/bridge.ts";
import { createConversation, type Scheduler } from "../conversation-store.ts";
import { isAnswering } from "../conversation.ts";
import { isOpen, liveOutput, moveOf, movesOf, taskCount, type TasksState } from "../tasks-state.ts";
import { unseenCount } from "../later-state.ts";
import { useDevices } from "../use-devices.ts";
import { useLater } from "../use-later.ts";
import { useMemory } from "../use-memory.ts";
import { usePower } from "../use-power.ts";
import { controlKey, useTasks } from "../use-tasks.ts";
import { Composer } from "./Composer.tsx";
import { ConfirmationGate } from "./ConfirmationGate.tsx";
import { DevicesPlace } from "./DevicesPlace.tsx";
import { Header } from "./Header.tsx";
import { MemoryPlace } from "./MemoryPlace.tsx";
import { MessageList, type Plans } from "./MessageList.tsx";
import { ModelsPlace } from "./ModelsPlace.tsx";
import { ScreenPlace } from "./ScreenPlace.tsx";
import { Sidebar, type PlaceName } from "./Sidebar.tsx";

const screenScheduler: Scheduler = {
  frame: (run) => {
    requestAnimationFrame(() => run());
  },
  later: (run, ms) => {
    const timer = window.setTimeout(run, ms);
    return () => window.clearTimeout(timer);
  },
};

function goalsOf(state: TasksState): readonly Task[] {
  return [...state.tasks.values()].filter((task) => task.kind === "goal");
}

function screenJob(state: TasksState): Task | null {
  const goals = goalsOf(state);
  const open = goals.filter(isOpen).sort((left, right) => right.created_at.localeCompare(left.created_at));
  return open[0] ?? [...goals].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null;
}

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
  const later = useLater(bridge, connection);
  const [place, setPlace] = useState<PlaceName>("chat");
  const openLink = useCallback((url: string) => void bridge.openLink(url), [bridge]);
  const saveDocument = useCallback((document: ChatDocument) => bridge.saveDocument(document), [bridge]);
  const { control, controlling, state, sending, answer, answerMove, loadMoves, stopTask, settings, save } = tasks;
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
      carryOn: () => void send("continue"),
    }),
    [state, device.id, devices.devices, controlling, control, sending, answer, answerMove, loadMoves, stopTask, send],
  );
  const inChat = useMemo(() => new Set(messages.filter((message) => message.kind === "plan" && message.task_id !== null).map((message) => message.task_id)), [messages]);
  const gateQueue = useMemo(() => state.queue.filter((request) => !inChat.has(request.task_id)), [state.queue, inChat]);
  const gateClosed = useMemo(() => state.closed.filter((entry) => !inChat.has(entry.request.task_id)), [state.closed, inChat]);
  const job = useMemo(() => screenJob(state), [state]);
  const signals = useMemo(() => ({ waiting: taskCount(state).needsYou, working: goalsOf(state).some(isOpen), later: unseenCount(later.items) }), [state, later.items]);
  const askAgain = useCallback(
    (effect: SkippableEffect) => {
      if (settings !== null) {
        void save({ ...settings, skip_asking: settings.skip_asking.filter((listed) => listed !== effect) });
      }
    },
    [settings, save],
  );

  useEffect(() => conversation.connect(), [conversation]);

  return (
    <div className="flex h-full flex-col">
      <Header
        connection={connection}
        deviceCount={devices.devices.length}
        menu={{
          account,
          skipped: settings?.skip_asking ?? [],
          saving: tasks.saving,
          failure: tasks.failure,
          developer: tasks.developer,
          onAskAgain: askAgain,
          onDrill: tasks.drill,
          onSignOut: () => devices.remove(device.id),
        }}
        halt={tasks.halt}
        onStop={tasks.stop}
      />
      <div className="flex min-h-0 flex-1 flex-col min-[960px]:flex-row">
        <Sidebar current={place} signals={signals} onChoose={setPlace} />
        <main className={`min-h-0 min-w-0 flex-1 flex-col ${place === "chat" ? "flex" : "hidden"}`}>
          <MessageList store={store} devices={devices.devices} deviceId={device.id} plans={plans} onOpenLink={openLink} onSaveDocument={saveDocument} />
          <Composer connection={connection} answering={answering} notice={notice} onSend={send} onDismiss={dismiss} />
        </main>
        {place !== "chat" && (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {place === "screen" && (
              <ScreenPlace
                task={job}
                moves={job === null ? [] : movesOf(state, job.id)}
                loaded={job !== null && state.loaded.has(job.id)}
                picture={job === null ? null : (state.pictures.get(job.id) ?? null)}
                deviceId={device.id}
                devices={devices.devices}
                stopping={job !== null && controlling.has(controlKey(job.id, "stop"))}
                later={later}
                onLoad={loadMoves}
                onStop={(taskId) => void stopTask(taskId)}
                onOpenLink={openLink}
              />
            )}
            {place === "devices" && <DevicesPlace state={devices} />}
            {place === "memory" && <MemoryPlace state={memory} />}
            {place === "models" && <ModelsPlace state={power} />}
          </main>
        )}
      </div>
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
