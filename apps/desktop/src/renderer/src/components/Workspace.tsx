import type { Account, ChatDocument, Device, SkippableEffect, Task } from "@venom/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import type { VenomBridge } from "../../../shared/bridge.ts";
import { createConversation, type Scheduler } from "../conversation-store.ts";
import { isAnswering } from "../conversation.ts";
import { isOpen, liveOutput, moveOf, movesOf, taskCount, type TasksState } from "../tasks-state.ts";
import { unseenCount } from "../later-state.ts";
import { awakeFor, watcherWords } from "../live-screen.ts";
import { useDevices } from "../use-devices.ts";
import { useLater } from "../use-later.ts";
import { useLiveScreen } from "../use-live-screen.ts";
import { useMemory } from "../use-memory.ts";
import { usePower } from "../use-power.ts";
import { useScreenShare } from "../use-screen-share.ts";
import { controlKey, useTasks } from "../use-tasks.ts";
import { Backdrop } from "./Backdrop.tsx";
import { Composer, type Seed } from "./Composer.tsx";
import { ConfirmationGate } from "./ConfirmationGate.tsx";
import { DevicesPlace } from "./DevicesPlace.tsx";
import { Header } from "./Header.tsx";
import { MemoryPlace } from "./MemoryPlace.tsx";
import { MessageList, type Plans } from "./MessageList.tsx";
import { engineName, ModelsPlace } from "./ModelsPlace.tsx";
import { Rail } from "./Rail.tsx";
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
  const [seed, setSeed] = useState<Seed | null>(null);
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
      stopping: (taskId) => controlling.has(controlKey(taskId, "stop")),
      stop: (taskId) => void stopTask(taskId),
      loadMoves,
      answerMove: (taskId, moveId, decision) => void answerMove(taskId, moveId, decision),
      carryOn: () => void send("continue"),
      watch: () => setPlace("screen"),
    }),
    [state, device.id, devices.devices, controlling, control, sending, answer, answerMove, loadMoves, stopTask, send],
  );
  const inChat = useMemo(() => new Set(messages.filter((message) => message.kind === "plan" && message.task_id !== null).map((message) => message.task_id)), [messages]);
  const gateQueue = useMemo(() => state.queue.filter((request) => !inChat.has(request.task_id)), [state.queue, inChat]);
  const gateClosed = useMemo(() => state.closed.filter((entry) => !inChat.has(entry.request.task_id)), [state.closed, inChat]);
  const job = useMemo(() => screenJob(state), [state]);
  const signals = useMemo(() => ({ waiting: taskCount(state).needsYou, working: goalsOf(state).some(isOpen), later: unseenCount(later.items) }), [state, later.items]);
  const engine = power.power === null ? null : engineName(power.engines, power.power);
  const live = useLiveScreen(bridge, devices.devices, device.id, connection, place === "screen");
  const share = useScreenShare(bridge, devices.devices, device);
  const self = devices.devices.find((candidate) => candidate.id === device.id) ?? null;
  const workingHere = goalsOf(state).some((goal) => isOpen(goal) && goal.target_device_id === device.id);
  const awake = awakeFor(self, share.watchers.length > 0, workingHere);
  const online = devices.devices.filter((candidate) => candidate.status === "active").length;
  const waiting = (signals.waiting ? 1 : 0) + signals.later;
  const ask = useCallback(
    async (text: string) => {
      setPlace("chat");
      return send(text);
    },
    [send],
  );
  const quick = useCallback((text: string) => {
    setPlace("chat");
    setSeed({ text, at: Date.now() });
  }, []);
  const askAgain = useCallback(
    (effect: SkippableEffect) => {
      if (settings !== null) {
        void save({ ...settings, skip_asking: settings.skip_asking.filter((listed) => listed !== effect) });
      }
    },
    [settings, save],
  );

  useEffect(() => conversation.connect(), [conversation]);

  useEffect(() => {
    void bridge.keepAwake(awake);
  }, [bridge, awake]);

  return (
    <div className="relative flex h-full flex-col">
      <Backdrop />
      <Header
        connection={connection}
        deviceCount={devices.devices.length}
        waiting={waiting}
        watchedBy={watcherWords(share.watchers)}
        onAsk={ask}
        onWaiting={() => setPlace(signals.waiting || signals.later === 0 ? "chat" : "screen")}
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
      <div className="flex min-h-0 flex-1 gap-4 px-3 pt-2 pb-[92px] sm:px-5 min-[960px]:pb-5">
        <Sidebar current={place} signals={signals} engine={engine} onChoose={setPlace} />
        <main className={`glass min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel ${place === "chat" ? "flex" : "hidden"}`}>
          <MessageList name={account.name} store={store} devices={devices.devices} deviceId={device.id} plans={plans} onOpenLink={openLink} onSaveDocument={saveDocument} />
          <Composer connection={connection} answering={answering} notice={notice} seed={seed} onSend={send} onDismiss={dismiss} />
        </main>
        {place === "chat" && (
          <Rail devicesOnline={online} engine={engine} answersLeft={power.power?.answers_left ?? null} memories={memory.items.length} working={signals.working} onQuick={quick} />
        )}
        {place !== "chat" && (
          <main className="glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel">
            {place === "screen" && (
              <ScreenPlace
                task={job}
                moves={job === null ? [] : movesOf(state, job.id)}
                loaded={job !== null && state.loaded.has(job.id)}
                picture={job === null ? null : (state.pictures.get(job.id) ?? null)}
                deviceId={device.id}
                devices={devices.devices}
                live={live}
                watched={share.watchers.length > 0}
                using={devices.using}
                stopping={job !== null && controlling.has(controlKey(job.id, "stop"))}
                later={later}
                onUse={(deviceId) => void devices.use(deviceId)}
                onDevices={() => setPlace("devices")}
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
