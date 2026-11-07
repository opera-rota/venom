import type { Device, Step, Task } from "@venom/contracts";
import { howItRuns, whyItAsks } from "../plan-words.ts";
import { button, mark, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { lookOfTask, routeTag, stepLook } from "./StepList.tsx";

export interface PlanCardProps {
  readonly task: Task | undefined;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly discarding: boolean;
  readonly starting: boolean;
  readonly output: (stepId: string) => string | null;
  readonly onDiscard: (taskId: string) => void;
  readonly onRun: (taskId: string) => void;
}

interface PlanStepProps {
  readonly step: Step;
  readonly position: number;
  readonly started: boolean;
  readonly live: string | null;
}

function ScriptOutput({ step, live }: { readonly step: Step; readonly live: string | null }) {
  const shown = step.status === "running" || step.output === null ? live : step.output;
  if (shown === null || shown.trim() === "") {
    return null;
  }
  return (
    <pre
      aria-label="Script output"
      aria-live={step.status === "running" ? "polite" : "off"}
      className="tabular mt-1 max-h-56 overflow-auto rounded-control border border-line bg-sunken p-2.5 text-[12px] leading-normal whitespace-pre-wrap break-words text-ink-muted"
    >
      {shown}
    </pre>
  );
}

function PlanStep({ step, position, started, live }: PlanStepProps) {
  const look = stepLook[step.status];
  return (
    <li className="flex items-start gap-3">
      {started ? (
        <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center ${look.tone}`} title={look.word}>
          <Icon name={look.icon} />
        </span>
      ) : (
        <span className={`tabular mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-2 ${text.detail} text-ink-muted`}>{position}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] text-ink">{step.summary}</span>
        <span className={`${text.support} break-words`}>{started ? `${look.word}. ${howItRuns(step.spec)}` : howItRuns(step.spec)}</span>
        {step.spec.name === "run_script" && (
          <details className="group" open={!started}>
            <summary className={`${button.mini} -ml-2 cursor-pointer list-none`}>
              <Icon name="chevron" className="h-3 w-3 transition-transform duration-140 group-open:rotate-180" />
              Show the script
            </summary>
            <pre className="tabular mt-1.5 max-h-48 overflow-auto rounded-control border border-line bg-sunken p-2.5 text-[12px] leading-normal whitespace-pre-wrap break-words text-ink-muted">
              {step.spec.code}
            </pre>
          </details>
        )}
        {step.spec.name === "run_script" ? (
          <ScriptOutput step={step} live={live} />
        ) : (
          started && step.output !== null && step.status !== "pending" && <span className={`${text.support} break-words`}>{step.output}</span>
        )}
        {!started &&
          (step.requires_confirmation ? (
            <span className={`${mark.reason} self-start`}>{whyItAsks(step)}</span>
          ) : (
            !step.reversible && <span className={`${text.detail} text-ink-faint`}>Cannot be undone</span>
          ))}
      </span>
    </li>
  );
}

export function PlanCard({ task, deviceId, devices, discarding, starting, output, onDiscard, onRun }: PlanCardProps) {
  if (task === undefined) {
    return <p className={`mt-3 border-t border-line-subtle pt-3 ${text.support}`}>This plan is no longer among your recent tasks.</p>;
  }
  const look = lookOfTask(task);
  const planned = task.status === "planned";
  const offline = planned && task.target_device_id !== null && !devices.some((device) => device.id === task.target_device_id && device.status === "active");
  return (
    <section aria-label="Plan" className="mt-3 flex flex-col gap-3 border-t border-line-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={`flex items-center gap-1.5 ${text.detail} ${look.tone}`}>
          <Icon name={look.icon} />
          <span>{look.word}</span>
        </span>
        <span className={`${text.detail} text-ink-faint`}>{routeTag(task.target_device_id, deviceId, devices)}</span>
      </div>
      <ol className="flex flex-col gap-3">
        {task.plan.map((step) => (
          <PlanStep key={step.id} step={step} position={step.order + 1} started={!planned} live={output(step.id)} />
        ))}
      </ol>
      {planned ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button.compact} disabled={starting || discarding} onClick={() => onRun(task.id)}>
              <Icon name="play" className="h-3 w-3 text-status-ok" />
              {starting ? "Starting…" : "Run it"}
            </button>
            <button type="button" className={button.mini} disabled={discarding || starting} onClick={() => onDiscard(task.id)}>
              <Icon name="cross" className="h-3 w-3" />
              {discarding ? "Discarding…" : "Discard plan"}
            </button>
          </div>
          <p className={text.support}>{offline ? "That computer is offline right now, so it cannot run this yet." : "Nothing runs until you press Run it or say \"run it\"."}</p>
        </div>
      ) : (
        task.result !== null && <p className={text.support}>{task.result}</p>
      )}
    </section>
  );
}
