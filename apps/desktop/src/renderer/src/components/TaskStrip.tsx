import type { Device, Task } from "@venom/contracts";
import { isOpen } from "../tasks-state.ts";
import { button, mark, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { routeTag, StepList, taskLook } from "./StepList.tsx";

export interface TaskStripProps {
  readonly task: Task;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly onDismiss: (taskId: string) => void;
  readonly onOpenTasks: () => void;
}

export function TaskStrip({ task, deviceId, devices, onDismiss, onOpenTasks }: TaskStripProps) {
  const look = taskLook[task.status];
  const open = isOpen(task);

  return (
    <section aria-label="Task in motion" className={`mx-5 mt-3 flex flex-col gap-3 p-4 ${open ? surface.cardActive : surface.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-medium text-ink">{task.request_text}</span>
          <span className={`flex items-center gap-1.5 ${text.detail} ${look.tone}`}>
            <span className={`${mark.dot} ${look.dot}`} />
            <Icon name={look.icon} />
            <span>{look.word}</span>
            <span className="text-ink-faint">· {routeTag(task.target_device_id, deviceId, devices)}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onOpenTasks} className={button.mini}>
            <Icon name="list" className="h-3 w-3" />
            Open in Tasks
          </button>
          {!open && (
            <button type="button" onClick={() => onDismiss(task.id)} className={button.ghost} aria-label="Hide this task">
              <Icon name="cross" />
            </button>
          )}
        </div>
      </div>
      <ProgressBar progress={task.progress} />
      <StepList task={task} deviceId={deviceId} devices={devices} compact />
      {task.result !== null && <p className={`border-t border-line-subtle pt-3 ${text.support}`}>{task.result}</p>}
    </section>
  );
}
