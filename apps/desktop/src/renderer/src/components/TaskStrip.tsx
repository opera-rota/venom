import type { Device, StepStatus, Task, TaskStatus } from "@venom/contracts";
import { isOpen } from "../tasks-state.ts";
import { button, mark, surface, text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";

interface Look {
  readonly word: string;
  readonly icon: IconName;
  readonly tone: string;
  readonly dot: string;
}

const stepLook: Record<StepStatus, Look> = {
  pending: { word: "Pending", icon: "dash", tone: "text-ink-muted", dot: "bg-status-idle" },
  waiting: { word: "Waiting", icon: "hourglass", tone: "text-status-wait", dot: "bg-status-wait" },
  running: { word: "Running", icon: "hourglass", tone: "text-status-ok", dot: "bg-status-ok" },
  done: { word: "Finished", icon: "check", tone: "text-status-ok", dot: "bg-status-ok" },
  failed: { word: "Failed", icon: "cross", tone: "text-status-fail", dot: "bg-status-fail" },
  skipped: { word: "Skipped", icon: "dash", tone: "text-ink-muted", dot: "bg-status-idle" },
  stopped: { word: "Stopped", icon: "stop", tone: "text-status-fail", dot: "bg-status-fail" },
};

const taskLook: Record<TaskStatus, Look> = {
  created: stepLook.pending,
  planned: stepLook.pending,
  running: stepLook.running,
  awaiting_confirmation: { ...stepLook.waiting, word: "Waiting for your confirmation" },
  completed: stepLook.done,
  failed: stepLook.failed,
  cancelled: { ...stepLook.stopped, word: "Cancelled" },
  stopped: stepLook.stopped,
};

function where(task: Task, deviceId: string, devices: readonly Device[]): string {
  const target = task.target_device_id;
  if (target === null) {
    return "Not on a device";
  }
  if (target === deviceId) {
    return "On this computer";
  }
  return `On ${devices.find((device) => device.id === target)?.name ?? "another device"}`;
}

export interface TaskStripProps {
  readonly task: Task;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly onDismiss: (taskId: string) => void;
}

export function TaskStrip({ task, deviceId, devices, onDismiss }: TaskStripProps) {
  const look = taskLook[task.status];
  const open = isOpen(task);

  return (
    <section aria-label="Task in motion" className={`mx-5 mt-3 p-4 ${open ? surface.cardActive : surface.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium text-ink">{task.request_text}</span>
          <span className={`flex items-center gap-1.5 ${text.detail} ${look.tone}`}>
            <span className={`${mark.dot} ${look.dot}`} />
            <Icon name={look.icon} />
            <span>{look.word}</span>
            <span className="text-ink-faint">· {where(task, deviceId, devices)}</span>
          </span>
        </div>
        {!open && (
          <button type="button" onClick={() => onDismiss(task.id)} className={button.ghost} aria-label="Hide this task">
            <Icon name="cross" />
          </button>
        )}
      </div>
      <ol className="mt-3 flex flex-col gap-2" aria-live="polite">
        {task.plan.map((step) => {
          const stepView = stepLook[step.status];
          return (
            <li key={step.id} className="flex items-start gap-3">
              <span className={`mt-0.5 flex w-24 shrink-0 items-center gap-1.5 ${text.detail} ${stepView.tone}`}>
                <Icon name={stepView.icon} />
                <span>{stepView.word}</span>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] text-ink">{step.summary}</span>
                {step.output !== null && <span className={text.support}>{step.output}</span>}
              </span>
              {step.requires_confirmation && <span className={`ml-auto ${mark.caution}`}>Needs confirmation</span>}
            </li>
          );
        })}
      </ol>
      {task.result !== null && <p className={`mt-3 border-t border-line-subtle pt-3 ${text.support}`}>{task.result}</p>}
    </section>
  );
}
