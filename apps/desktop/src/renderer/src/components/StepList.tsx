import type { Device, Step, StepStatus, Task, TaskControl, TaskStatus } from "@venom/contracts";
import { useState, type FormEvent } from "react";
import { button, field, mark, text } from "../ui.ts";
import { Icon, type IconName } from "./Icon.tsx";

export interface Look {
  readonly word: string;
  readonly icon: IconName;
  readonly tone: string;
  readonly dot: string;
}

export const stepLook: Record<StepStatus, Look> = {
  pending: { word: "Pending", icon: "dash", tone: "text-ink-muted", dot: "bg-status-idle" },
  waiting: { word: "Waiting", icon: "hourglass", tone: "text-status-wait", dot: "bg-status-wait" },
  running: { word: "Running", icon: "hourglass", tone: "text-status-ok", dot: "bg-status-ok" },
  done: { word: "Finished", icon: "check", tone: "text-status-ok", dot: "bg-status-ok" },
  failed: { word: "Failed", icon: "cross", tone: "text-status-fail", dot: "bg-status-fail" },
  skipped: { word: "Skipped", icon: "skip", tone: "text-ink-muted", dot: "bg-status-idle" },
  stopped: { word: "Stopped", icon: "stop", tone: "text-status-fail", dot: "bg-status-fail" },
  ignored: { word: "Ignored", icon: "dash", tone: "text-ink-faint", dot: "bg-status-idle" },
};

export const taskLook: Record<TaskStatus, Look> = {
  created: stepLook.pending,
  planned: stepLook.pending,
  running: stepLook.running,
  awaiting_confirmation: { ...stepLook.waiting, word: "Waiting for your confirmation" },
  completed: stepLook.done,
  failed: stepLook.failed,
  cancelled: { ...stepLook.stopped, word: "Cancelled" },
  stopped: stepLook.stopped,
};

export function routeTag(deviceId: string | null, thisDevice: string, devices: readonly Device[]): string {
  if (deviceId === null) {
    return "Not on a device";
  }
  if (deviceId === thisDevice) {
    return "On this computer";
  }
  return `On ${devices.find((device) => device.id === deviceId)?.name ?? "another device"}`;
}

export interface StepControls {
  busy(kind: TaskControl["kind"], stepId: string): boolean;
  send(control: TaskControl): Promise<boolean>;
}

type SetAside = "skip" | "ignore";

interface Asking {
  readonly stepId: string;
  readonly kind: SetAside;
}

type Offer =
  | { readonly does: "ask"; readonly label: string; readonly icon: IconName; readonly kind: SetAside }
  | { readonly does: "send"; readonly label: string; readonly icon: IconName; readonly control: TaskControl };

function offers(task: Task, step: Step): readonly Offer[] {
  if (task.status === "completed") {
    return [];
  }
  const canIgnore = task.progress.counted > 1;
  const skip: Offer = { does: "ask", label: "Skip", icon: "skip", kind: "skip" };
  const ignore: Offer = { does: "ask", label: "Ignore", icon: "dash", kind: "ignore" };
  const restore: Offer = { does: "send", label: "Count again", icon: "undo", control: { kind: "restore", step_id: step.id } };
  const retry: Offer = { does: "send", label: "Retry", icon: "retry", control: { kind: "retry", step_id: step.id } };
  switch (step.status) {
    case "pending":
      return canIgnore ? [skip, ignore] : [skip];
    case "failed":
      return [...(step.repeatable ? [retry, skip] : []), ...(canIgnore ? [ignore] : [])];
    case "skipped":
      return canIgnore ? [ignore, restore] : [restore];
    case "ignored":
      return [restore];
    default:
      return [];
  }
}

export interface StepListProps {
  readonly task: Task;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly controls?: StepControls;
  readonly compact?: boolean;
}

export function StepList({ task, deviceId, devices, controls, compact = false }: StepListProps) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [reason, setReason] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (asking === null || controls === undefined || reason.trim() === "") {
      return;
    }
    const sent = await controls.send({ kind: asking.kind, step_id: asking.stepId, reason: reason.trim() });
    if (sent) {
      setAsking(null);
      setReason("");
    }
  }

  return (
    <ol className="flex flex-col gap-2.5" aria-live="polite">
      {task.plan.map((step) => {
        const look = stepLook[step.status];
        const offered = controls === undefined ? [] : offers(task, step);
        const askingHere = asking?.stepId === step.id ? asking : null;
        const stepTarget = step.target.kind === "device" ? step.target.device_id : null;
        const showRoute = !compact || stepTarget !== task.target_device_id;
        return (
          <li key={step.id} className="flex flex-col gap-1.5">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex w-20 shrink-0 items-center gap-1.5 ${text.detail} ${look.tone}`}>
                <Icon name={look.icon} />
                <span>{look.word}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`text-[13px] ${step.status === "ignored" ? "text-ink-faint line-through" : "text-ink"}`}>{step.summary}</span>
                {step.output !== null && <span className={text.support}>{step.output}</span>}
                {step.set_aside_reason !== null && (
                  <span className={text.support}>
                    {step.status === "ignored" ? "Ignored" : "Skipped for later"}: {step.set_aside_reason}
                  </span>
                )}
                {(showRoute || step.requires_confirmation) && (
                  <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {showRoute && <span className={`${text.detail} text-ink-faint`}>{routeTag(stepTarget, deviceId, devices)}</span>}
                    {step.requires_confirmation && <span className={mark.caution}>Needs confirmation</span>}
                  </span>
                )}
              </span>
            </div>
            {offered.length > 0 && askingHere === null && (
              <div className="ml-23 flex flex-wrap gap-1">
                {offered.map((offer) => {
                  if (offer.does === "ask") {
                    return (
                      <button key={offer.label} type="button" className={button.mini} onClick={() => setAsking({ stepId: step.id, kind: offer.kind })}>
                        <Icon name={offer.icon} className="h-3 w-3" />
                        {offer.label}
                      </button>
                    );
                  }
                  const busy = controls?.busy(offer.control.kind, step.id) ?? false;
                  return (
                    <button key={offer.label} type="button" className={button.mini} disabled={busy} onClick={() => void controls?.send(offer.control)}>
                      <Icon name={offer.icon} className="h-3 w-3" />
                      {busy ? "Sending…" : offer.label}
                    </button>
                  );
                })}
              </div>
            )}
            {askingHere !== null && (
              <form onSubmit={(event) => void submit(event)} className="ml-23 flex flex-col gap-2">
                <label className={field.label} htmlFor={`reason-${step.id}`}>
                  {askingHere.kind === "skip" ? "Why skip it for now? It still counts, and VENOM comes back to it at the end." : "Why ignore it? It stops counting, so the total shrinks."}
                </label>
                <input
                  id={`reason-${step.id}`}
                  autoFocus
                  maxLength={300}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  onKeyDown={(event) => event.key === "Escape" && setAsking(null)}
                  placeholder="A few words are enough"
                  className={field.text}
                />
                <div className="flex gap-2">
                  <button type="submit" className={button.compact} disabled={reason.trim() === "" || (controls?.busy(askingHere.kind, step.id) ?? false)}>
                    {controls?.busy(askingHere.kind, step.id) ? "Sending…" : askingHere.kind === "skip" ? "Skip step" : "Ignore step"}
                  </button>
                  <button type="button" className={button.ghost} onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </li>
        );
      })}
    </ol>
  );
}
