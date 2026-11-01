import type { Device, Step, Task } from "@venom/contracts";
import { howItRuns, whyItAsks } from "../plan-words.ts";
import { button, mark, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";
import { lookOfTask, routeTag } from "./StepList.tsx";

export interface PlanCardProps {
  readonly task: Task | undefined;
  readonly deviceId: string;
  readonly devices: readonly Device[];
  readonly discarding: boolean;
  readonly onDiscard: (taskId: string) => void;
}

function PlanStep({ step, position }: { readonly step: Step; readonly position: number }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`tabular mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-2 ${text.detail} text-ink-muted`}>{position}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px] text-ink">{step.summary}</span>
        <span className={`${text.support} break-words`}>{howItRuns(step.spec)}</span>
        {step.spec.name === "run_script" && (
          <details className="group">
            <summary className={`${button.mini} -ml-2 cursor-pointer list-none`}>
              <Icon name="chevron" className="h-3 w-3 transition-transform duration-140 group-open:rotate-180" />
              Show the script
            </summary>
            <pre className="tabular mt-1.5 max-h-48 overflow-auto rounded-control border border-line bg-sunken p-2.5 text-[12px] leading-normal whitespace-pre-wrap break-words text-ink-muted">
              {step.spec.code}
            </pre>
          </details>
        )}
        {step.requires_confirmation ? (
          <span className={`${mark.caution} max-w-full self-start whitespace-normal`}>{whyItAsks(step)}</span>
        ) : (
          !step.reversible && <span className={`${text.detail} text-ink-faint`}>Cannot be undone</span>
        )}
      </span>
    </li>
  );
}

export function PlanCard({ task, deviceId, devices, discarding, onDiscard }: PlanCardProps) {
  if (task === undefined) {
    return <p className={`mt-3 border-t border-line-subtle pt-3 ${text.support}`}>This plan is no longer among your recent tasks.</p>;
  }
  const look = lookOfTask(task);
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
          <PlanStep key={step.id} step={step} position={step.order + 1} />
        ))}
      </ol>
      {task.status === "planned" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={text.support}>Nothing runs yet.</p>
          <button type="button" className={button.mini} disabled={discarding} onClick={() => onDiscard(task.id)}>
            <Icon name="cross" className="h-3 w-3" />
            {discarding ? "Discarding…" : "Discard plan"}
          </button>
        </div>
      ) : (
        task.result !== null && <p className={text.support}>{task.result}</p>
      )}
    </section>
  );
}
