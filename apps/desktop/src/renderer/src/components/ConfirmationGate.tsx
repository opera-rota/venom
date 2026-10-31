import type { ConfirmDecision, ConfirmRequest, Effect, Risk } from "@venom/contracts";
import { useEffect, useId, useRef } from "react";
import type { Closed } from "../tasks-state.ts";
import { button, mark, surface, text } from "../ui.ts";
import { Icon } from "./Icon.tsx";

const reasonWords: Record<Effect, string> = {
  deletes: "It deletes something.",
  pays: "It spends money.",
  uses_credential: "It uses a password or key.",
  posts: "It posts or sends something.",
  reaches_outside: "It reaches a service outside this device.",
};

const riskWords: Record<Risk, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

const outcomeWords: Record<Closed["answered"]["outcome"], string> = {
  approved: "Approved",
  declined: "Declined",
  stopped: "Stopped",
};

export interface ConfirmationGateProps {
  readonly queue: readonly ConfirmRequest[];
  readonly closed: readonly Closed[];
  readonly deviceId: string;
  readonly sending: ReadonlySet<string>;
  readonly onAnswer: (request: ConfirmRequest, decision: ConfirmDecision) => void;
  readonly onSeen: (stepId: string) => void;
}

function Notice({ closed, onSeen }: { readonly closed: Closed; readonly onSeen: (stepId: string) => void }) {
  const { request, answered } = closed;

  useEffect(() => {
    const timer = window.setTimeout(() => onSeen(request.step_id), 3000);
    return () => window.clearTimeout(timer);
  }, [onSeen, request.step_id]);

  return (
    <div role="status" className={`fixed bottom-24 left-1/2 z-40 -translate-x-1/2 px-4 py-3 ${surface.overlay}`}>
      <p className={text.support}>
        {answered.outcome === "stopped" ? "The confirmation closed because everything was stopped." : `${outcomeWords[answered.outcome]} on ${answered.device_name ?? "another device"}.`}
      </p>
    </div>
  );
}

export function ConfirmationGate({ queue, closed, deviceId, sending, onAnswer, onSeen }: ConfirmationGateProps) {
  const request = queue[0];
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const actionId = useId();
  const elsewhere = closed.find((entry) => entry.answered.device_id !== deviceId);

  useEffect(() => {
    cancel.current?.focus();
  }, [request?.step_id]);

  if (request === undefined) {
    return elsewhere === undefined ? null : <Notice closed={elsewhere} onSeen={onSeen} />;
  }

  const busy = sending.has(request.step_id);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={actionId}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onAnswer(request, "decline");
          }
        }}
        className={`flex w-full max-w-[520px] flex-col gap-4 p-6 ${surface.overlay}`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className={`flex items-center gap-2 ${text.section}`}>
            <Icon name="hourglass" className="h-4 w-4 text-status-wait" />
            <span>VENOM needs your confirmation</span>
          </h2>
          {queue.length > 1 && <span className={`tabular ${text.detail} text-ink-muted`}>1 of {queue.length}</span>}
        </div>
        <p id={actionId} className="text-[15px] leading-relaxed text-ink">
          {request.plain_language}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={mark.caution}>{riskWords[request.risk]}</span>
          <span className={`${text.detail} text-ink-muted`}>On {request.target_name}</span>
        </div>
        {request.reasons.length > 0 && (
          <ul className="flex flex-col gap-1">
            {request.reasons.map((reason) => (
              <li key={reason} className={`flex items-center gap-2 ${text.support}`}>
                <Icon name="warning" className="h-3.5 w-3.5 text-status-wait" />
                <span>{reasonWords[reason]}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button ref={cancel} type="button" disabled={busy} onClick={() => onAnswer(request, "decline")} className={button.gateCancel}>
            {busy ? "Sending…" : "Cancel"}
          </button>
          <button type="button" disabled={busy} onClick={() => onAnswer(request, "approve")} className={button.gateApprove}>
            <Icon name="warning" className="h-3.5 w-3.5 text-status-wait" />
            <span>{busy ? "Sending…" : "Approve"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
