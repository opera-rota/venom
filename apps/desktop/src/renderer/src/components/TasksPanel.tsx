import type { Device, Task, TaskControl } from "@venom/contracts";
import { useState } from "react";
import { isOpen, taskGroups, type TaskGroupName } from "../tasks-state.ts";
import { controlKey, type TasksHandle } from "../use-tasks.ts";
import { button, field, mark, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { StepList, taskLook, type StepControls } from "./StepList.tsx";

const groupTone: Record<TaskGroupName, string> = {
  needs_you: "text-status-wait",
  running: "text-status-ok",
  finished: "text-ink-muted",
  failed: "text-status-fail",
  stopped: "text-ink-muted",
};

const resumable: ReadonlySet<Task["status"]> = new Set(["stopped", "failed", "cancelled"]);

interface TaskCardProps {
  readonly task: Task;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly handle: TasksHandle;
  readonly deviceId: string;
  readonly devices: readonly Device[];
}

function TaskCard({ task, expanded, onToggle, handle, deviceId, devices }: TaskCardProps) {
  const look = taskLook[task.status];
  const open = isOpen(task);
  const stopping = handle.controlling.has(controlKey(task.id, "stop"));
  const resuming = handle.controlling.has(controlKey(task.id, "resume"));
  const controls: StepControls = {
    busy: (kind, stepId) => handle.controlling.has(controlKey(task.id, kind, kind === "resume" ? null : stepId)),
    send: (control: TaskControl) => handle.control(task.id, control),
  };

  return (
    <article className={`flex flex-col gap-3 p-3.5 ${open ? surface.cardActive : surface.card}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-ink">{task.request_text}</span>
          <span className={`flex items-center gap-1.5 ${text.detail} ${look.tone}`}>
            <span className={`${mark.dot} ${look.dot}`} />
            <Icon name={look.icon} />
            <span>{look.word}</span>
          </span>
        </span>
        <Icon name="chevron" className={`mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-140 ease-ui ${expanded ? "rotate-180" : ""}`} />
      </button>
      <ProgressBar progress={task.progress} />
      {task.result !== null && <p className={text.support}>{task.result}</p>}
      {expanded && (
        <>
          <div className={mark.divider} />
          <StepList task={task} deviceId={deviceId} devices={devices} controls={controls} />
          {(open || resumable.has(task.status)) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {open && (
                <button type="button" className={button.destructive} disabled={stopping} onClick={() => void handle.stopTask(task.id)}>
                  <Icon name="stop" />
                  {stopping ? "Stopping…" : "Stop this task"}
                </button>
              )}
              {resumable.has(task.status) && (
                <button type="button" className={button.compact} disabled={resuming} onClick={() => void handle.control(task.id, { kind: "resume" })}>
                  <Icon name="play" />
                  {resuming ? "Sending…" : "Resume"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}

export interface TasksPanelProps {
  readonly handle: TasksHandle;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly onClose: () => void;
}

export function TasksPanel({ handle, deviceId, devices, onClose }: TasksPanelProps) {
  const groups = taskGroups(handle.state);
  const [chosen, setChosen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const latest = [...handle.state.tasks.values()].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]?.id ?? null;
  const expanded = chosen ?? latest;

  async function startDrill() {
    setStarting(true);
    await handle.drill("progress");
    setStarting(false);
    setChosen(null);
  }

  return (
    <aside aria-label="Tasks" className={`flex w-[380px] max-w-full shrink-0 flex-col ${surface.panel}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className={text.section}>Tasks</h2>
        <button type="button" onClick={onClose} className={button.ghost} aria-label="Close tasks">
          <Icon name="cross" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <p className={text.support}>Progress is counted by the cloud from finished steps, never guessed. Skip keeps a step counted for later; ignore stops counting it.</p>
        <div className="flex flex-col gap-1.5">
          <button type="button" className={button.primary} disabled={starting} onClick={() => void startDrill()}>
            {starting ? "Starting…" : "Start the progress drill"}
          </button>
          <span className={text.support}>Five practice steps of 8 seconds on this computer. Ignore one while it runs and watch the total shrink.</span>
        </div>
        {handle.failure !== null && (
          <p role="alert" className={field.error}>
            <Icon name="cross" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{handle.failure}</span>
          </p>
        )}
        {groups.length === 0 && <p className={text.support}>No tasks yet. Start the progress drill to see one.</p>}
        {groups.map((group) => (
          <section key={group.name} aria-label={group.title} className="flex flex-col gap-2.5">
            <h3 className={`${text.detail} ${groupTone[group.name]}`}>
              {group.title} · <span className="tabular-nums">{group.tasks.length}</span>
            </h3>
            {group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                expanded={expanded === task.id}
                onToggle={() => setChosen(expanded === task.id ? "" : task.id)}
                handle={handle}
                deviceId={deviceId}
                devices={devices}
              />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
